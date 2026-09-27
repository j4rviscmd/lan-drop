//! Local CA + per-launch leaf certificate for warning-free HTTPS on the LAN.
//!
//! The CA is generated once and persisted in the app data dir. The iPhone
//! installs it once (profile install + Certificate Trust Settings) and then
//! trusts every leaf we issue. The leaf is re-issued on each launch so DHCP IP
//! changes are always covered by the SAN list.

use std::{net::IpAddr, path::Path};

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, SanType};

const CA_COMMON_NAME: &str = "lan-drop local CA";

pub struct Ca {
    pub cert_pem: String,
    key_pem: String,
}

impl Ca {
    /// Load the CA from `dir`, creating and persisting it on first run.
    /// A present-but-corrupt pair (e.g. crash mid-write) is regenerated
    /// instead of bricking every launch.
    pub fn load_or_create(dir: &Path) -> std::io::Result<Ca> {
        let cert_path = dir.join("ca.pem");
        let key_path = dir.join("ca.key");
        if let (Ok(cert_pem), Ok(key_pem)) = (
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&key_path),
        ) {
            if !cert_pem.is_empty() && !key_pem.is_empty() && ca_pair_is_valid(&cert_pem, &key_pem)
            {
                return Ok(Ca { cert_pem, key_pem });
            }
        }
        let ca = Ca::generate()?;
        std::fs::write(&cert_path, &ca.cert_pem)?;
        std::fs::write(&key_path, &ca.key_pem)?;
        Ok(ca)
    }

    fn generate() -> std::io::Result<Ca> {
        let mut params = CertificateParams::new(Vec::<String>::new())
            .map_err(|e| std::io::Error::other(format!("ca params: {e}")))?;
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params
            .distinguished_name
            .push(DnType::CommonName, CA_COMMON_NAME);
        // Why: rcgen's default validity (1975..4096) is rejected outright by
        // Apple's TLS policy. Roots are exempt from the leaf limits, but keep
        // a sane 10-year window anyway.
        let now = time::OffsetDateTime::now_utc();
        params.not_before = now - time::Duration::days(1);
        params.not_after = now + time::Duration::days(3650);
        let key = KeyPair::generate().map_err(|e| std::io::Error::other(format!("ca key: {e}")))?;
        let cert = params
            .self_signed(&key)
            .map_err(|e| std::io::Error::other(format!("ca cert: {e}")))?;
        Ok(Ca {
            cert_pem: cert.pem(),
            key_pem: key.serialize_pem(),
        })
    }

    /// Issue a leaf certificate covering `ip` (plus loopback/localhost).
    /// Returns `(chain_pem, key_pem)` for `RustlsConfig::from_pem`
    /// (chain = leaf followed by the CA).
    pub fn issue_leaf_pem(&self, ip: IpAddr) -> Result<(Vec<u8>, String), String> {
        let e = |err: rcgen::Error| err.to_string();
        let ca_key = KeyPair::from_pem(&self.key_pem).map_err(e)?;
        let issuer = rcgen::Issuer::from_ca_cert_pem(&self.cert_pem, &ca_key).map_err(e)?;

        let mut params = CertificateParams::new(Vec::<String>::new()).map_err(e)?;
        params.subject_alt_names = vec![
            SanType::IpAddress(ip),
            SanType::IpAddress(IpAddr::from([127, 0, 0, 1])),
            SanType::DnsName("localhost".try_into().map_err(e)?),
        ];
        // Why: Safari rejects leaves whose validity exceeds Apple's TLS
        // policy limit (825/398 days); rcgen's default 1975..4096 window made
        // every iPhone connection fail with certificate_unknown. The leaf is
        // re-issued on every launch, so 90 days costs nothing.
        let now = time::OffsetDateTime::now_utc();
        params.not_before = now - time::Duration::days(1);
        params.not_after = now + time::Duration::days(90);
        let leaf_key = KeyPair::generate().map_err(e)?;
        let leaf = params.signed_by(&leaf_key, &issuer).map_err(e)?;

        let mut chain = leaf.pem().into_bytes();
        chain.extend_from_slice(self.cert_pem.as_bytes());
        Ok((chain, leaf_key.serialize_pem()))
    }
}

/// True when the stored cert/key pair parses and can still sign leaves.
fn ca_pair_is_valid(cert_pem: &str, key_pem: &str) -> bool {
    KeyPair::from_pem(key_pem)
        .is_ok_and(|key| rcgen::Issuer::from_ca_cert_pem(cert_pem, &key).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("lan-drop-tls-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn ca_persists_and_issues_leaf_with_chain() {
        let dir = temp_dir("persist");
        let ca = Ca::load_or_create(&dir).unwrap();
        let again = Ca::load_or_create(&dir).unwrap();
        assert_eq!(ca.cert_pem, again.cert_pem, "CA must be stable across runs");

        let (chain, key) = ca.issue_leaf_pem("192.168.0.5".parse().unwrap()).unwrap();
        let chain = String::from_utf8(chain).unwrap();
        assert_eq!(chain.matches("BEGIN CERTIFICATE").count(), 2, "leaf + CA");
        assert!(key.starts_with("-----BEGIN PRIVATE KEY-----"));
        assert!(
            chain.trim_end().ends_with(ca.cert_pem.trim()),
            "chain must end with the CA certificate"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
