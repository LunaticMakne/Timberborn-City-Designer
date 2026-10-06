param(
  [Parameter(Mandatory = $true)][string]$GamePath,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot '../data/game-catalog.json' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$assets = Join-Path $GamePath 'Timberborn_Data/StreamingAssets'
$blueprintsPath = Join-Path $assets 'Modding/Blueprints.zip'
$localizationsPath = Join-Path $assets 'Modding/Localizations.zip'
$blueprints = [IO.Compression.ZipFile]::OpenRead($blueprintsPath)
$localizations = $null
try {
  $localizations = [IO.Compression.ZipFile]::OpenRead($localizationsPath)
  function Read-ZipText($archive, [string]$path) {
    $entry = $archive.GetEntry($path)
    if (-not $entry) { throw "Missing archive entry: $path" }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  function Read-Blueprint([string]$path) {
    return (Read-ZipText $blueprints $path | ConvertFrom-Json)
  }
  $translations = @{}
  foreach ($language in @('koKR', 'enUS')) {
    $lookup = @{}
    foreach ($row in (Read-ZipText $localizations "$language.csv" | ConvertFrom-Csv)) {
      if ($row.ID) {
        if ($lookup.ContainsKey($row.ID) -and $lookup[$row.ID] -ne $row.Text) { throw "Duplicate translation: $language/$($row.ID)" }
        $lookup[$row.ID] = $row.Text
      }
    }
    $translations[$language] = $lookup
  }
  $missingNames = [Collections.Generic.List[string]]::new()
  function Name-For([string]$key, [string]$fallback, [string]$language) {
    if ($key -and $translations[$language].ContainsKey($key) -and $translations[$language][$key]) { return $translations[$language][$key] }
    $missingNames.Add("$language/$fallback/$key")
    if ($key -and $translations.enUS.ContainsKey($key) -and $translations.enUS[$key]) { return $translations.enUS[$key] }
    return $fallback
  }
  $memberships = @{}
  $collections = @()
  foreach ($family in @('Buildings', 'NaturalResources')) {
    foreach ($faction in @('Common', 'Folktails', 'IronTeeth')) {
      $path = "TemplateCollections/TemplateCollection.$family.$faction.blueprint.json"
      $collection = (Read-Blueprint $path).TemplateCollectionSpec
      $references = @($collection.Blueprints)
      $collections += [ordered]@{ family=$family; faction=$faction; references=$references }
      foreach ($reference in $references) {
        $entryPath = "$reference.json"
        if (-not $blueprints.GetEntry($entryPath)) { throw "Missing collection reference: $entryPath" }
        if (-not $memberships.ContainsKey($entryPath)) { $memberships[$entryPath] = @() }
        $memberships[$entryPath] += if ($faction -eq 'Common') { @('folktails','iron-teeth') } elseif ($faction -eq 'Folktails') { 'folktails' } else { 'iron-teeth' }
      }
    }
  }
  $goods = @()
  foreach ($entry in ($blueprints.Entries | Where-Object { $_.FullName -like 'Goods/*.blueprint.json' } | Sort-Object FullName)) {
    $good = (Read-Blueprint $entry.FullName).GoodSpec
    if ($good.Id) { $goods += [ordered]@{ id=$good.Id; name=(Name-For $good.DisplayNameLocKey $good.Id 'koKR'); enName=(Name-For $good.DisplayNameLocKey $good.Id 'enUS') } }
  }
  $records = @()
  $excluded = @()
  $seen = @{}
  foreach ($entry in ($blueprints.Entries | Where-Object { $_.FullName -match '^(Buildings|NaturalResources)/.+\.blueprint\.json$' } | Sort-Object FullName)) {
    $object = Read-Blueprint $entry.FullName
    if (-not $object.BlockObjectSpec) {
      $excluded += [ordered]@{ sourcePath=$entry.FullName; reason='No BlockObjectSpec: auxiliary definition' }
      continue
    }
    $id = $object.TemplateSpec.TemplateName
    if (-not $id -and -not $memberships.ContainsKey($entry.FullName)) {
      $excluded += [ordered]@{ sourcePath=$entry.FullName; reason='No TemplateName: unregistered auxiliary occupancy definition' }
      continue
    }
    if (-not $id -or $seen.ContainsKey($id)) { throw "Missing or duplicate TemplateName: $($entry.FullName)" }
    $seen[$id] = $true
    $size = $object.BlockObjectSpec.Size
    if ($size.X -lt 1 -or $size.Y -lt 1 -or $size.Z -lt 1 -or $object.BlockObjectSpec.Blocks.Count -ne ($size.X * $size.Y * $size.Z)) { throw "Invalid block volume: $id" }
    $kind = if ($entry.FullName -like 'NaturalResources/Crops/*') {'crop'} elseif ($entry.FullName -like 'NaturalResources/Trees/*') {'tree'} elseif ($entry.FullName -like 'NaturalResources/Bushes/*') {'bush'} else {'building'}
    $record = [ordered]@{
      id=$id; sourcePath=$entry.FullName; kind=$kind
      factions=@($memberships[$entry.FullName] | Where-Object { $_ } | Sort-Object -Unique)
      nameKey=$object.LabeledEntitySpec.DisplayNameLocKey
      name=(Name-For $object.LabeledEntitySpec.DisplayNameLocKey $id 'koKR')
      enName=(Name-For $object.LabeledEntitySpec.DisplayNameLocKey $id 'enUS')
      group=$object.PlaceableBlockObjectSpec.ToolGroupId
      order=$object.PlaceableBlockObjectSpec.ToolOrder
      block=$object.BlockObjectSpec
      path=$object.PathSpec
      navigation=$object.BlockObjectNavMeshSettingsSpec
      plant=$null
    }
    if ($kind -ne 'building') {
      $record.plant = [ordered]@{
        planting=$object.PlantableSpec; growth=$object.GrowableSpec
        cutting=$object.CuttableSpec; gathering=$object.GatherableSpec
        watered=$object.WateredNaturalResourceSpec; flooding=$object.FloodableNaturalResourceSpec
        arid=$object.AridNaturalResourceSpec
      }
    }
    $records += $record
  }
  $version = (Get-Content -LiteralPath (Join-Path $assets 'VersionNumbers.json') -Raw | ConvertFrom-Json).CurrentVersion
  $manifestPath = Join-Path $GamePath '../../appmanifest_1062090.acf'
  $buildId = $null
  if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw
    if ($manifest -match '"buildid"\s+"(\d+)"') { $buildId = $Matches[1] }
  }
  $catalog = [ordered]@{
    schemaVersion=1
    source=[ordered]@{ version=$version; fullVersion=(Get-Content -LiteralPath (Join-Path $assets 'Version.txt') -Raw).Trim(); buildId=$buildId; blueprintsSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $blueprintsPath).Hash; localizationsSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $localizationsPath).Hash }
    mapSize=(Read-Blueprint 'Configurations/MapSize.blueprint.json').MapSizeSpec
    collections=$collections; goods=$goods; objects=$records; excluded=$excluded
    missingNames=@($missingNames | Sort-Object -Unique)
  }
  # Generate only after every record validates. Replace atomically in the same directory.
  $destination = [IO.Path]::GetFullPath($OutputPath)
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  $temporary = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, (($catalog | ConvertTo-Json -Depth 60) + "`n"), [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($destination)) { [IO.File]::Replace($temporary, $destination, [System.Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($temporary, $destination) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
  Write-Output "Exported $($records.Count) objects ($($excluded.Count) auxiliary definitions excluded), version $version; missing names: $($catalog.missingNames.Count)"
} finally {
  if ($localizations) { $localizations.Dispose() }
  $blueprints.Dispose()
}
