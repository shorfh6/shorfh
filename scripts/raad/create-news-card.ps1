param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
if(-not [IO.Path]::IsPathRooted($InputFile) -or -not [IO.Path]::IsPathRooted($OutputFile)){throw 'Absolute card paths required'}
if(-not (Test-Path -LiteralPath (Split-Path -Parent $OutputFile) -PathType Container) -or (Test-Path -LiteralPath $OutputFile)){throw 'Existing parent and unused original-card path required'}
$data=[IO.File]::ReadAllText($InputFile,[Text.Encoding]::UTF8) | ConvertFrom-Json
if($data.title -isnot [string] -or $data.title.Length -lt 5 -or $data.title.Length -gt 200){throw 'Bound card title required'}
$bitmap=New-Object Drawing.Bitmap(1200,675)
$g=[Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$green=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#193D35'))
$cream=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#F5F3E9'))
$gold=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#BDA76F'))
$muted=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#536B60'))
$title=New-Object Drawing.Font('Tahoma',36,[Drawing.FontStyle]::Bold)
$label=New-Object Drawing.Font('Tahoma',23,[Drawing.FontStyle]::Regular)
$small=New-Object Drawing.Font('Tahoma',18,[Drawing.FontStyle]::Regular)
$rtl=New-Object Drawing.StringFormat
$rtl.FormatFlags=[Drawing.StringFormatFlags]::DirectionRightToLeft
$rtl.Alignment=[Drawing.StringAlignment]::Near
$rtl.LineAlignment=[Drawing.StringAlignment]::Center
try{
 $g.Clear([Drawing.ColorTranslator]::FromHtml('#F5F3E9'))
 $g.FillRectangle($green,0,0,1200,14)
 $g.FillRectangle($gold,1100,180,10,270)
 $g.DrawString('شُرفة  |  متابعة إخبارية',$label,$green,[Drawing.RectangleF]::new(70,45,1040,75),$rtl)
 $g.DrawString($data.title,$title,$green,[Drawing.RectangleF]::new(85,170,970,285),$rtl)
 $g.DrawString('المصدر: عكاظ  —  تغطية أصلية من شُرفة',$small,$muted,[Drawing.RectangleF]::new(70,495,1040,65),$rtl)
 $g.FillRectangle($green,0,595,1200,80)
 $g.DrawString('بطاقة توضيحية أصلية — ليست صورة للحدث',$small,$cream,[Drawing.RectangleF]::new(70,600,1040,65),$rtl)
 $bitmap.Save($OutputFile,[Drawing.Imaging.ImageFormat]::Png)
}finally{foreach($item in @($rtl,$title,$label,$small,$green,$cream,$gold,$muted,$g,$bitmap)){$item.Dispose()}}
