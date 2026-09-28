; Windows Defender Firewall: pre-register an inbound allow rule so the OS
; "allow this app to communicate on private/public networks" dialog never
; appears on first launch. The app listens on 0.0.0.0 (HTTPS + CA setup).
;
; The currentUser installer runs unelevated (RequestExecutionLevel user) and
; firewall rules require admin, so each netsh runs through a single UAC
; elevation. ExecWait + Start-Process -Wait keeps the rule in place before
; the finish page can launch the app.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "firewall: registering lan-drop inbound allow rule"
  ; delete-then-add keeps the rule unique across in-place upgrade installs
  ExecWait `powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall delete rule name=lan-drop & netsh advfirewall firewall add rule name=lan-drop dir=in action=allow program=\"$INSTDIR\${MAINBINARYNAME}.exe\" enable=yes profile=any' -Verb RunAs -Wait -WindowStyle Hidden"`
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "firewall: removing lan-drop inbound allow rule"
  ExecWait `powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall delete rule name=lan-drop' -Verb RunAs -Wait -WindowStyle Hidden"`
!macroend
