param([ValidateSet('read','answer')][string]$Action='read')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]
$condition=[System.Windows.Automation.Condition]::TrueCondition
$questionName=New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty,'Question')
$documentCondition=New-Object System.Windows.Automation.PropertyCondition($ae::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document)
function Get-TrustedPids {
 $verified=@{}
 foreach($p in @(Get-Process -Name 'ChatGPT','Codex' -ErrorAction SilentlyContinue)){
  try {
   $exe=$p.Path;if(!$exe){continue}
   if(!$verified.ContainsKey($exe)){
    $signature=Get-AuthenticodeSignature -LiteralPath $exe
    $verified[$exe]=($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '(?i)(?:^|,\s*)O="?OpenAI(?: OpCo)?(?:,?\s*(?:LLC|Inc\.?))?"?\s*(?:,|$)')
   }
   if($verified[$exe]){$p.Id}
  }catch{continue}
 }
}
$allowedPids=@(Get-TrustedPids)
function Find-Questions {
$results=@()
$script:observedTitles=@()
$script:observedIdentities=@()
$script:scanComplete=$true
foreach($window in $ae::RootElement.FindAll($scope::Children,$condition)){
 try {if($allowedPids -notcontains $window.Current.ProcessId){continue}}catch{continue}
 try {
  $documents=@($window.FindAll($scope::Descendants,$documentCondition) | Where-Object {$_.Current.Name})
  if($documents.Count -ne 1){continue}
  $script:observedTitles+=@($documents[0].Current.Name)
  $identity=('{0}:{1}:{2}' -f $window.Current.ProcessId,$window.Current.NativeWindowHandle,($documents[0].GetRuntimeId() -join '.'))
  $script:observedIdentities+=@($identity)
  $seenGroups=@{}
  foreach($label in $window.FindAll($scope::Descendants,$questionName)){
   $group=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($label)
   if(!$group -or $group.Current.ControlType -ne [System.Windows.Automation.ControlType]::Group){continue}
   $groupId=$group.GetRuntimeId() -join '.';if($seenGroups.ContainsKey($groupId)){continue};$seenGroups[$groupId]=$true
   $children=@($group.FindAll($scope::Descendants,$condition));$edits=@($children | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit})
   if($edits.Count -ne 1 -or $edits[0].Current.IsPassword){continue}
   $rawTexts=@($children | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text} | ForEach-Object {$_.Current.Name})
   $position=@($rawTexts | Where-Object {$_ -match '^\d+\s+(of|sur|de|von|di|/)\s+\d+$'} | Select-Object -First 1)
   # Unknown page-counter languages are ambiguous; do not expose a guessed question.
   if(@($rawTexts | Where-Object {$_ -match '^\d+\s+\p{L}{1,8}\s+\d+$' -and $_ -notmatch '^\d+\s+(of|sur|de|von|di)\s+\d+$'}).Count){continue}
   $texts=@($rawTexts | Where-Object {$_ -and $_ -ne 'Question' -and $_ -notmatch '^\d+\s+(of|sur|de|von|di|/)\s+\d+$'})
   if(!$texts.Count -or $texts[0].Length -gt 4000){continue}
   $options=@($children | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton} | ForEach-Object {$_.Current.Name})
   # Do not silently omit an option: an incomplete choice list is unsafe.
   if($options.Count -gt 12 -or @($options | Where-Object {!$_ -or $_.Length -gt 1500}).Count){continue}
   $results+=@{identity=$identity;title=$documents[0].Current.Name;question=$texts[0];position=if($position.Count){$position[0]}else{''};options=$options;group=$group;edit=$edits[0]}
  }
 } catch {$script:scanComplete=$false;continue}
}
return $results
}
function Same-Question($current,$requested){
 if($current.identity -cne $requested.identity -or $current.title -cne $requested.title -or $current.question -cne $requested.question -or $current.position -cne $requested.position){return $false}
 $a=@($current.options);$b=@($requested.options);if($a.Count -ne $b.Count){return $false}
 for($i=0;$i -lt $a.Count;$i++){if($a[$i] -cne $b[$i]){return $false}}
 return $true
}
$results=@(Find-Questions)
if(!$script:scanComplete -or $results.Count -ne 1){[Console]::Out.WriteLine('{"available":false}');exit}
$current=$results[0]
if($Action -eq 'read'){
 [Console]::Out.WriteLine((@{available=$true;identity=$current.identity;title=$current.title;question=$current.question;position=$current.position;options=@($current.options)}|ConvertTo-Json -Depth 5 -Compress));exit
}
$inputAttempted=$false
$selectionCompleted=$false
try {
 $requested=[Console]::In.ReadToEnd()|ConvertFrom-Json
 if(!(Same-Question $current $requested) -or !($requested.answer -is [string]) -or $requested.answer.Length -gt 4000 -or !$requested.answer.Trim()){throw 'stale'}
 $children=@($current.group.FindAll($scope::Descendants,$condition))
 $radios=@($children | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton})
 $draft=$current.edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value.Trim()
 if($draft -and $draft -cne $current.edit.Current.Name.Trim()){throw 'draft'}
 foreach($radio in $radios){if($radio.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected){throw 'draft'}}
 $matches=@($radios | Where-Object {$_.Current.Name -ceq $requested.answer})
 if($matches.Count -eq 1){$inputAttempted=$true;$matches[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select();$selectionCompleted=$true}
 elseif($matches.Count -eq 0){$inputAttempted=$true;$current.edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($requested.answer)}
 else{throw 'ambiguous'}
 # Re-read the form immediately before invoking a button; never send to a changed question.
 for($n=0;$n -lt 10;$n++){
  Start-Sleep -Milliseconds 150
  $now=@(Find-Questions)
  if($script:scanComplete -and $now.Count -eq 0 -and $script:observedIdentities.Count -eq 1 -and $script:observedIdentities[0] -ceq $requested.identity){
   # Some Codex forms submit when the uniquely matched option is selected.
   # Require the selection operation to have returned and the original trusted
   # document to still exist before accepting the closed form as confirmation.
   if($selectionCompleted){[Console]::Out.WriteLine('{"submitted":true}');exit}
   [Console]::Out.WriteLine('{"submitted":false,"uncertain":true,"formClosedAfterInput":true}');exit
  }
  if(!$script:scanComplete -or $now.Count -ne 1 -or !(Same-Question $now[0] $requested)){throw 'stale'}
  $nowChildren=@($now[0].group.FindAll($scope::Descendants,$condition))
  $nowRadios=@($nowChildren | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton})
  $selected=@($nowRadios | Where-Object {$_.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected})
  if($matches.Count -eq 1){if($selected.Count -ne 1 -or $selected[0].Current.Name -cne $requested.answer){throw 'changed'}}
  else{
   # Some forms automatically select their explicit Other option when text is entered.
   # Never allow an unrelated option to be silently selected.
   if($selected.Count -gt 1 -or ($selected.Count -eq 1 -and $selected[0].Current.Name -notmatch '^(?i:other|autre)\s*$')){throw 'changed'}
   if($now[0].edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value.Trim() -cne $requested.answer.Trim()){throw 'changed'}
  }
  $buttons=@($nowChildren | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('Envoyer','Send','Suivant','Next') -and $_.Current.IsEnabled})
  if($buttons.Count -eq 1){
   $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
   for($attempt=0;$attempt -lt 2;$attempt++){
    Start-Sleep -Milliseconds 100
    $after=@(Find-Questions)
    if($script:scanComplete -and $script:observedTitles.Count -eq 1 -and $script:observedTitles[0] -ceq $requested.title -and $script:observedIdentities[0] -ceq $requested.identity -and ($after.Count -eq 0 -or ($after.Count -eq 1 -and !(Same-Question $after[0] $requested)))){[Console]::Out.WriteLine('{"submitted":true}');exit}
   }
   [Console]::Out.WriteLine('{"submitted":false,"uncertain":true}');exit
  }
 }
 throw 'unavailable'
} catch {
 if($selectionCompleted){
  try {
   $after=@(Find-Questions)
   if($script:scanComplete -and $after.Count -eq 0 -and $script:observedIdentities.Count -eq 1 -and $script:observedIdentities[0] -ceq $requested.identity){[Console]::Out.WriteLine('{"submitted":true}');exit}
  } catch { }
 }
 # UI Automation can throw after applying input (including automatic submit).
 # Never report the question as unavailable or retry blindly in that case:
 # the relay must verify the exact new reply in the conversation.
 if($inputAttempted){[Console]::Out.WriteLine('{"submitted":false,"uncertain":true,"formClosedAfterInput":true}')}
 else{[Console]::Out.WriteLine('{"submitted":false}')}
 exit 1
}
