param([string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$target=$OutputPath
if(-not $target){$target=Join-Path $PSScriptRoot '..\..\docs\raad\media\shurfa-baha-winter-schedule-20261029.png'}
if(-not (Test-Path -LiteralPath (Split-Path -Parent $target))){throw 'Existing media directory required'}
if(Test-Path -LiteralPath $target){throw 'Original card already exists; inspect instead of overwriting'}
$bitmap=New-Object Drawing.Bitmap(1200,675)
$g=[Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$green=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#193D35'))
$cream=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#F5F3E9'))
$gold=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#BDA76F'))
$muted=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#536B60'))
$white=New-Object Drawing.SolidBrush([Drawing.Color]::White)
$title=New-Object Drawing.Font('Tahoma',43,[Drawing.FontStyle]::Bold)
$label=New-Object Drawing.Font('Tahoma',23,[Drawing.FontStyle]::Regular)
$small=New-Object Drawing.Font('Tahoma',17,[Drawing.FontStyle]::Regular)
$time=New-Object Drawing.Font('Tahoma',68,[Drawing.FontStyle]::Bold)
$rtl=New-Object Drawing.StringFormat
$rtl.FormatFlags=[Drawing.StringFormatFlags]::DirectionRightToLeft
$rtl.Alignment=[Drawing.StringAlignment]::Near
$center=New-Object Drawing.StringFormat
$center.Alignment=[Drawing.StringAlignment]::Center
try{
 $g.Clear([Drawing.ColorTranslator]::FromHtml('#F5F3E9'))
 $g.FillRectangle($green,0,0,1200,14)
 $g.DrawString('شُرفة',$label,$green,[Drawing.RectangleF]::new(70,40,1060,50),$rtl)
 $g.DrawString('دوام مدارس الباحة',$title,$green,[Drawing.RectangleF]::new(65,104,1070,90),$rtl)
 $g.DrawString('مواعيد التوقيت الشتوي بحسب تغطية عكاظ',$label,$muted,[Drawing.RectangleF]::new(70,196,1060,55),$rtl)
 $g.FillRectangle($green,625,280,505,220)
 $g.FillRectangle($white,70,280,505,220)
 $g.FillRectangle($gold,625,280,505,5)
 $g.FillRectangle($gold,70,280,505,5)
 $g.DrawString('07:15',$time,$cream,[Drawing.RectangleF]::new(640,292,475,115),$center)
 $g.DrawString('07:30',$time,$green,[Drawing.RectangleF]::new(85,292,475,115),$center)
 $g.DrawString('الاصطفاف الصباحي',$label,$cream,[Drawing.RectangleF]::new(640,426,475,50),$center)
 $g.DrawString('الحصة الأولى',$label,$green,[Drawing.RectangleF]::new(85,426,475,50),$center)
 $g.DrawString('الموعدان صباحًا  |  الفاصل: 15 دقيقة',$label,$muted,[Drawing.RectangleF]::new(70,531,1060,50),$rtl)
 $g.DrawString('29 أكتوبر 2026  —  تصميم توضيحي أصلي؛ ليس صورة لمدرسة',$small,$muted,[Drawing.RectangleF]::new(70,610,1060,40),$rtl)
 $bitmap.Save($target,[Drawing.Imaging.ImageFormat]::Png)
 [PSCustomObject]@{created=$true;width=1200;height=675;kind='original-illustration';publisherImagesUsed=$false} | ConvertTo-Json
}finally{
 foreach($item in @($rtl,$center,$title,$label,$small,$time,$green,$cream,$gold,$muted,$white,$g,$bitmap)){$item.Dispose()}
}
