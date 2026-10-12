param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ColumnIndex([string]$Reference) {
  $letters = ([regex]::Match($Reference, "^[A-Z]+")).Value
  $index = 0
  foreach ($letter in $letters.ToCharArray()) {
    $index = ($index * 26) + ([int][char]$letter - 64)
  }
  return $index
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
try {
  function Read-Entry([string]$Name) {
    $entry = $archive.GetEntry($Name)
    if (-not $entry) { throw "Required workbook entry is missing." }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }

  [xml]$workbook = Read-Entry "xl/workbook.xml"
  [xml]$relationships = Read-Entry "xl/_rels/workbook.xml.rels"
  [xml]$sharedStringXml = Read-Entry "xl/sharedStrings.xml"

  $relationshipMap = @{}
  foreach ($relationship in $relationships.Relationships.Relationship) {
    $relationshipMap[$relationship.Id] = ([string]$relationship.Target).TrimStart("/")
  }

  $sharedStrings = @()
  foreach ($item in $sharedStringXml.sst.si) {
    if ($null -ne $item.t) {
      $sharedStrings += [string]$item.t
    } else {
      $sharedStrings += (($item.r | ForEach-Object { [string]$_.t }) -join "")
    }
  }

  function Get-CellValue($Cell) {
    if ($null -eq $Cell) { return "" }
    if ($Cell.t -eq "s") { return [string]$sharedStrings[[int]$Cell.v] }
    if ($Cell.t -eq "inlineStr") { return [string]$Cell.is.t }
    return [string]$Cell.v
  }

  $sheetMap = @{}
  foreach ($sheet in $workbook.workbook.sheets.sheet) {
    $relationshipId = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    $sheetMap[[string]$sheet.name] = $relationshipMap[$relationshipId]
  }

  $requiredSheets = @("IMPORT RADAR", "ENTRADA TRABAJADORES", "HISTORIAL PROYECTOS", "DOCUMENTOS", "AUDITORIA DOCUMENTAL", "CATALOGOS")
  foreach ($requiredSheet in $requiredSheets) {
    if (-not $sheetMap.ContainsKey($requiredSheet)) { throw "A required workbook sheet is missing." }
  }

  function Read-SheetRows([string]$SheetName) {
    [xml]$sheetXml = Read-Entry $sheetMap[$SheetName]
    $physicalRows = @($sheetXml.worksheet.sheetData.row)
    if ($physicalRows.Count -eq 0) { return @() }
    $headers = @{}
    foreach ($cell in @($physicalRows[0].c)) {
      $headers[(Get-ColumnIndex ([string]$cell.r))] = Get-CellValue $cell
    }
    $result = @()
    foreach ($row in ($physicalRows | Select-Object -Skip 1)) {
      $values = [ordered]@{}
      foreach ($cell in @($row.c)) {
        $header = $headers[(Get-ColumnIndex ([string]$cell.r))]
        if ($header) { $values[$header] = Get-CellValue $cell }
      }
      if (@($values.Values | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) {
        $result += [pscustomobject]@{ rowNumber = [int]$row.r; values = $values }
      }
    }
    return $result
  }

  $importRows = @(Read-SheetRows "IMPORT RADAR")
  $documentRows = @(Read-SheetRows "DOCUMENTOS")
  $additionalDocuments = @()
  foreach ($row in $documentRows) {
    $credentialType = [string]$row.values["CREDENTIAL / LICENSE TYPE"]
    if ($credentialType -in @("FORKLIFT OPERATOR", "HEAVY EARTH MOVING EQUIPMENT OPERATOR")) {
      $additionalDocuments += [pscustomobject]@{
        rowNumber = $row.rowNumber
        workerId = [string]$row.values["WORKER ID"]
        documentType = $credentialType
        expirationDate = [string]$row.values["EXPIRATION DATE"]
        verified = [string]$row.values["VERIFIED"]
      }
    }
  }

  $file = Get-Item -LiteralPath $WorkbookPath
  [pscustomobject]@{
    workbookPath = $file.FullName
    workbookTimestamp = $file.LastWriteTimeUtc.ToString("o")
    sheets = @($workbook.workbook.sheets.sheet | ForEach-Object { [string]$_.name })
    sourceRows = $importRows
    additionalDocuments = $additionalDocuments
    auxiliaryCounts = [ordered]@{
      entryWorkers = @(Read-SheetRows "ENTRADA TRABAJADORES").Count
      projectHistory = @(Read-SheetRows "HISTORIAL PROYECTOS").Count
      documents = $documentRows.Count
      documentAudit = @(Read-SheetRows "AUDITORIA DOCUMENTAL").Count
    }
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  $archive.Dispose()
}
