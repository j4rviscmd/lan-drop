// Quick usbmuxd device list probe: `cargo run --example usb_list`
use idevice::usbmuxd::UsbmuxdAddr;

#[tokio::main]
async fn main() {
    let addr: std::net::SocketAddr = "127.0.0.1:27015".parse().unwrap();
    let mut mux = UsbmuxdAddr::TcpSocket(addr)
        .connect(0)
        .await
        .expect("usbmuxd connect");
    println!("buid: {:?}", mux.get_buid().await);
    match mux.get_devices().await {
        Ok(devs) => {
            println!("devices: {}", devs.len());
            for d in devs {
                println!(
                    "  udid={} type={:?} id={}",
                    d.udid, d.connection_type, d.device_id
                );
            }
        }
        Err(e) => println!("list error: {e:?}"),
    }
}
