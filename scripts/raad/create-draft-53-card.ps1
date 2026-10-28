$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$project=if($PSScriptRoot){Split-Path (Split-Path $PSScriptRoot -Parent) -Parent}else{(Get-Location).Path}
if(-not [System.IO.File]::Exists((Join-Path $project 'scripts\raad\envelope.mjs'))){throw 'Shurfa project directory required'}
$folder=Join-Path $project 'docs\raad\media'
[System.IO.Directory]::CreateDirectory($folder) | Out-Null
$file=Join-Path $folder 'shurfa-alula-lasersetI-illustration.png'
if([System.IO.File]::Exists($file)){throw 'Illustration already exists; refusing to overwrite reviewed media'}
$image=New-Object System.Drawing.Bitmap(1200,675)
$g=[System.Drawing.Graphics]::FromImage($image)
$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$navy=[System.Drawing.ColorTranslator]::FromHtml('#102138')
$cyan=[System.Drawing.ColorTranslator]::FromHtml('#66D4DE')
$white=[System.Drawing.ColorTranslator]::FromHtml('#F1F6FA')
$muted=[System.Drawing.ColorTranslator]::FromHtml('#A9BED0')
$g.Clear($navy)
$cyanBrush=New-Object System.Drawing.SolidBrush($cyan)
$whiteBrush=New-Object System.Drawing.SolidBrush($white)
$mutedBrush=New-Object System.Drawing.SolidBrush($muted)
$line=New-Object System.Drawing.Pen($cyan,3)
$faint=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(55,$cyan),2)
foreach($s in @(@(90,97,4),@(192,132,3),@(314,80,4),@(378,164,3),@(61,279,3),@(140,478,3),@(387,481,4),@(477,106,3),@(437,330,3))){$g.FillEllipse($whiteBrush,$s[0],$s[1],$s[2],$s[2])}
$g.DrawEllipse($faint,61,191,340,340)
$g.DrawEllipse($faint,94,224,274,274)
$g.DrawEllipse($line,129,259,204,204)
$g.DrawLine($faint,40,361,424,361)
$g.DrawLine($faint,231,169,231,554)
$g.FillEllipse($cyanBrush,181,311,100,100)
$g.FillEllipse((New-Object System.Drawing.SolidBrush($navy)),194,324,74,74)
$g.DrawLine($line,300,289,387,202)
$g.FillEllipse($whiteBrush,378,193,18,18)
$rtl=New-Object System.Drawing.StringFormat
$rtl.FormatFlags=[System.Drawing.StringFormatFlags]::DirectionRightToLeft
$rtl.Alignment=[System.Drawing.StringAlignment]::Near
$rtl.LineAlignment=[System.Drawing.StringAlignment]::Center
$brand=New-Object System.Drawing.Font('Tahoma',23,[System.Drawing.FontStyle]::Bold)
$heading=New-Object System.Drawing.Font('Tahoma',49,[System.Drawing.FontStyle]::Bold)
$caption=New-Object System.Drawing.Font('Tahoma',21)
$latin=New-Object System.Drawing.Font('Arial',37,[System.Drawing.FontStyle]::Bold)
$g.DrawString('شُرفة | علوم وتقنية',$brand,$cyanBrush,(New-Object System.Drawing.RectangleF(470,58,660,70)),$rtl)
$g.DrawString('العلا وشبكة',$heading,$whiteBrush,(New-Object System.Drawing.RectangleF(440,189,690,100)),$rtl)
$g.DrawString('الرصد الفلكي',$heading,$whiteBrush,(New-Object System.Drawing.RectangleF(440,283,690,100)),$rtl)
$latinFormat=New-Object System.Drawing.StringFormat
$latinFormat.Alignment=[System.Drawing.StringAlignment]::Far
$g.DrawString('LaserSETI',$latin,$cyanBrush,(New-Object System.Drawing.RectangleF(450,406,675,75)),$latinFormat)
$g.DrawLine($faint,65,565,1135,565)
$g.DrawString('صورة توضيحية أصلية — ليست صورة للمحطتين',$caption,$mutedBrush,(New-Object System.Drawing.RectangleF(65,580,1070,60)),$rtl)
$image.Save($file,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$image.Dispose();$line.Dispose();$faint.Dispose();$cyanBrush.Dispose();$whiteBrush.Dispose();$mutedBrush.Dispose();$brand.Dispose();$heading.Dispose();$caption.Dispose();$latin.Dispose();$rtl.Dispose();$latinFormat.Dispose()
$bytes=[System.IO.File]::ReadAllBytes($file)
$sha=[System.Security.Cryptography.SHA256]::Create()
$hash=([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
$sha.Dispose()
[PSCustomObject]@{path=$file;width=1200;height=675;format='png';bytes=$bytes.Length;sha256=$hash;ownership='original-created-for-shurfa';kind='illustrative';label='صورة توضيحية أصلية — ليست صورة للمحطتين'} | ConvertTo-Json
