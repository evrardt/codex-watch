$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$out=Join-Path $root '.tools\CodexWatchBluetoothProtocolTest.exe'
& $compiler /nologo /target:exe /main:CodexWatchBluetoothProtocolTest ("/out:"+$out) (Join-Path $root 'desktop\bluetooth\CodexWatchBluetooth.cs') (Join-Path $root 'desktop\bluetooth\CodexWatchBluetoothProtocolTest.cs')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& $out
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
