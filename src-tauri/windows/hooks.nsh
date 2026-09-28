; Windows Defender Firewall: installers before the LAN-path removal release
; registered a program-scoped inbound allow rule (the app used to listen on
; 0.0.0.0 for HTTPS + CA setup). The app now binds 127.0.0.1 only, which the
; firewall never blocks, so no rule is registered anymore. The uninstall hook
; remains solely to clean up the rule left behind by older installers.

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "firewall: removing legacy lan-drop inbound allow rule"
  ExecWait `powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall delete rule name=lan-drop' -Verb RunAs -Wait -WindowStyle Hidden"`
!macroend
