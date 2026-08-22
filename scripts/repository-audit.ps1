$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tracked = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/](?:\.git|node_modules)[\\/]'
}

$forbiddenFiles = $tracked | Where-Object {
    $_.Name -match '^(?:\.env(?:\..*)?|id_rsa|id_ed25519)$' -or
    $_.Extension -match '^\.(?:pem|key|pfx|p12|log|db|sqlite)$'
}
if ($forbiddenFiles) {
    throw "Yasaklı dosya bulundu: $($forbiddenFiles.FullName -join ', ')"
}

$patterns = @(
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    'github_pat_[A-Za-z0-9_]{20,}',
    'gh[opusr]_[A-Za-z0-9]{20,}',
    'AKIA[0-9A-Z]{16}',
    'sk-[A-Za-z0-9_-]{20,}',
    'C:\\Users\\[^\\\s]+'
)

foreach ($file in $tracked | Where-Object { $_.Extension -notmatch '^\.(?:png|jpg|jpeg|gif|ico)$' }) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    foreach ($pattern in $patterns) {
        if ($content -match $pattern) {
            throw "Olası hassas veri bulundu: $($file.FullName)"
        }
    }
}

# Ürün anlatımında uygunsuz konumlandırmaya yol açabilecek örnekleri engeller.
# Terimler kodlanmış tutulur; depo içinde kendileri de örnek haline gelmez.
$unsuitableTermsBase64 = @(
    'cmVkZ2lmcw==',
    'cG9ybmh1Yg==',
    'eHZpZGVvcw==',
    'b25seWZhbnM=',
    'bnNmdw==',
    'cG9ybm8='
)
$unsuitableExamplePatterns = $unsuitableTermsBase64 | ForEach-Object {
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_))
}

foreach ($file in $tracked | Where-Object { $_.Extension -notmatch '^\.(?:png|jpg|jpeg|gif|ico)$' }) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    foreach ($pattern in $unsuitableExamplePatterns) {
        if ($content -match $pattern) {
            throw "Ürün konumlandırmasına uygun olmayan alan adı/ifade örneği bulundu: $($file.FullName)"
        }
    }
}

# Kamuya açık belgelerin taşınabilir ve ürün odaklı kalmasını sağlar.
$documentationOnlyTermsBase64 = @(
    'Z29vZC1kcGk=',
    'c3BsaXR3aXJl',
    'ZmlsZWNyeXB0'
)
$documentationPatterns = @('[A-Za-z]:\\') + ($documentationOnlyTermsBase64 | ForEach-Object {
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_))
})

foreach ($file in $tracked | Where-Object { $_.Extension -eq '.md' }) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    foreach ($pattern in $documentationPatterns) {
        if ($content -match $pattern) {
            throw "Kamuya açık belgede bağlama özgü gereksiz ayrıntı bulundu: $($file.FullName)"
        }
    }
}

Write-Host "Depo denetimi başarılı." -ForegroundColor Green
