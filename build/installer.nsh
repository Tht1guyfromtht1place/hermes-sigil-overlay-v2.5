!macro customUnInstall
  DetailPrint "Removing Hermes Sigil desktop bridge..."
  nsExec::ExecToLog '"$INSTDIR\Hermes Sigil Overlay.exe" --remove-bridge'
!macroend
