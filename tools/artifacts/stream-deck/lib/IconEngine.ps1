<#
    Icon drawing primitives.

    Ported verbatim from the hand-built Stream Deck setup
    (scripts/streamdeck/icons/IconEngine.ps1). It is proven code and the visual
    result is the point, so it is deliberately unmodified - composition into
    finished key icons lives in Render.ps1 instead.

    All drawing is System.Drawing (Windows-only), at 288x288 for a 72px key.
#>

Add-Type -AssemblyName System.Drawing

$SIZE = 288
$CORNER = 44
$BASE_BG = [System.Drawing.Color]::FromArgb(255, 26, 28, 33)
$WHITE = [System.Drawing.Color]::FromArgb(255, 245, 246, 248)
$MUTED_COLOR = [System.Drawing.Color]::FromArgb(255, 104, 109, 122)
$CHIP = [System.Drawing.Color]::FromArgb(255, 238, 240, 244)
$TOPBAR_H = 22

function New-Canvas {
    $bmp = New-Object System.Drawing.Bitmap($SIZE, $SIZE)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    return @{ Bmp = $bmp; G = $g }
}

function Get-RoundedRectPath($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    return $path
}

function Blend-Color($base, $accent, [double]$amount) {
    return [System.Drawing.Color]::FromArgb(255,
        [int]($base.R + ($accent.R - $base.R) * $amount),
        [int]($base.G + ($accent.G - $base.G) * $amount),
        [int]($base.B + ($accent.B - $base.B) * $amount))
}

# Placeholders keep a washed-out version of their category hue rather than turning flat grey,
# so an unfinished STATE key still reads as STATE. The dashed ring plus grey glyph and label
# carry the "not wired up yet" signal.
function Desaturate-Color($c, [double]$amount) {
    $lum = (0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B)
    return [System.Drawing.Color]::FromArgb(255,
        [int]($c.R + ($lum - $c.R) * $amount),
        [int]($c.G + ($lum - $c.G) * $amount),
        [int]($c.B + ($lum - $c.B) * $amount))
}

# Unconfigured keys now get the SAME full-colour treatment as working ones -- the old
# desaturated + dashed-ring look read as "broken/disabled" rather than "not wired up yet".
# The only difference is a small corner dot (Add-UnconfiguredDot).
function Get-EffectiveAccent($accent, [bool]$muted) {
    return $accent
}

# Card background is tinted toward the category accent so the whole tile carries the colour,
# not just a thin strip that disappears at 72px physical key size.
function Fill-Card($g, $accent, [bool]$muted) {
    $tintSrc = $accent
    $strength = 0.30
    $top = Blend-Color $BASE_BG $tintSrc ($strength * 1.25)
    $bottom = Blend-Color $BASE_BG $tintSrc ($strength * 0.55)

    $path = Get-RoundedRectPath 0 0 $SIZE $SIZE $CORNER
    $rect = New-Object System.Drawing.Rectangle(0, 0, $SIZE, $SIZE)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $top, $bottom, 90.0)
    $g.FillPath($brush, $path)
    $brush.Dispose(); $path.Dispose()
}

# Full-saturation bar along the TOP edge: the title text Stream Deck draws sits at the bottom,
# so a top bar reads clearly instead of fighting the label.
function Add-TopBar($g, $accent, [bool]$muted) {
    $barColor = Get-EffectiveAccent $accent $muted
    $g.SetClip((Get-RoundedRectPath 0 0 $SIZE $SIZE $CORNER))
    $brush = New-Object System.Drawing.SolidBrush($barColor)
    $g.FillRectangle($brush, 0, 0, $SIZE, $TOPBAR_H)
    $g.ResetClip()
    $brush.Dispose()
}

# Quiet "not wired up yet" marker: a small hollow dot just under the top bar, top-right.
# Visible on inspection, invisible at a glance -- unlike the old dashed ring.
function Add-UnconfiguredDot($g) {
    $d = 20
    $x = $SIZE - $d - 20
    $y = $TOPBAR_H + 14
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
    $g.FillEllipse($fill, $x, $y, $d, $d)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 255, 255, 255), 3)
    $g.DrawEllipse($pen, $x, $y, $d, $d)
    $fill.Dispose(); $pen.Dispose()
}

function Get-ImageStats([System.Drawing.Bitmap]$bmp) {
    $lumSum = 0.0; $count = 0; $opaque = 0; $total = 0
    $stepX = [Math]::Max(1, [int]($bmp.Width / 40))
    $stepY = [Math]::Max(1, [int]($bmp.Height / 40))
    for ($x = 0; $x -lt $bmp.Width; $x += $stepX) {
        for ($y = 0; $y -lt $bmp.Height; $y += $stepY) {
            $p = $bmp.GetPixel($x, $y)
            $total++
            if ($p.A -gt 200) { $opaque++ }
            if ($p.A -gt 32) {
                $lumSum += (0.2126 * $p.R + 0.7152 * $p.G + 0.0722 * $p.B) / 255.0
                $count++
            }
        }
    }
    $lum = if ($count -gt 0) { $lumSum / $count } else { 1.0 }
    $opacity = if ($total -gt 0) { $opaque / [double]$total } else { 0.0 }
    return @{ Luminance = $lum; Opacity = $opacity }
}

# Places a real logo. Opaque "tile" style icons get clipped to a rounded square so every
# tile looks consistent; dark transparent logos get a light chip behind them so they don't
# disappear against the dark card.
function Composite-Image($g, [string]$path, [double]$scaleFrac) {
    $img = [System.Drawing.Image]::FromFile($path)
    $src = New-Object System.Drawing.Bitmap($img)
    $img.Dispose()
    $stats = Get-ImageStats $src

    $target = [int]($SIZE * $scaleFrac)
    $scale = [Math]::Min($target / $src.Width, $target / $src.Height)
    $w = [int]($src.Width * $scale); $h = [int]($src.Height * $scale)
    $x = [int](($SIZE - $w) / 2); $y = [int](($SIZE - $h) / 2) + 4

    if ($stats.Opacity -gt 0.92) {
        # Opaque tile -> clip to rounded square for a consistent app-tile look.
        $clip = Get-RoundedRectPath $x $y $w $h ([int]($w * 0.22))
        $g.SetClip($clip)
        $g.DrawImage($src, $x, $y, $w, $h)
        $g.ResetClip()
        $clip.Dispose()
    } else {
        if ($stats.Luminance -lt 0.34) {
            $padChip = [int]($w * 0.12)
            $chipPath = Get-RoundedRectPath ($x - $padChip) ($y - $padChip) ($w + 2*$padChip) ($h + 2*$padChip) ([int]($w * 0.28))
            $chipBrush = New-Object System.Drawing.SolidBrush($CHIP)
            $g.FillPath($chipBrush, $chipPath)
            $chipBrush.Dispose(); $chipPath.Dispose()
        }
        $g.DrawImage($src, $x, $y, $w, $h)
    }
    $src.Dispose()
}

# Monochrome marks (e.g. the FP logo, whose native charcoal is invisible here) are recoloured
# to white while preserving alpha.
function Composite-ImageWhite($g, [string]$path, [double]$scaleFrac) {
    $img = [System.Drawing.Image]::FromFile($path)
    $target = [int]($SIZE * $scaleFrac)
    $scale = [Math]::Min($target / $img.Width, $target / $img.Height)
    $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
    $x = [int](($SIZE - $w) / 2); $y = [int](($SIZE - $h) / 2) + 4
    $rows = [float[][]]@(@(0,0,0,0,0), @(0,0,0,0,0), @(0,0,0,0,0), @(0,0,0,1,0), @(0.96,0.96,0.97,0,1))
    $cm = New-Object System.Drawing.Imaging.ColorMatrix (,$rows)
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetColorMatrix($cm)
    $dest = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
    $g.DrawImage($img, $dest, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $img.Dispose(); $attr.Dispose()
}

function Draw-LetterBadge($g, [string]$text, [bool]$muted) {
    $color = if ($muted) { $MUTED_COLOR } else { $WHITE }
    $fontSize = if ($text.Length -le 1) { 138 } elseif ($text.Length -eq 2) { 100 } else { 74 }
    # Use Segoe UI Emoji for characters in emoji ranges (supplementary plane or dingbats)
    $hasEmoji = $false
    foreach ($c in $text.ToCharArray()) {
        if ([int]$c -gt 0x2600 -or [char]::IsHighSurrogate($c)) { $hasEmoji = $true; break }
    }
    $fontFamily = if ($hasEmoji) { "Segoe UI Emoji" } else { "Segoe UI" }
    $font = New-Object System.Drawing.Font($fontFamily, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush($color)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, ($TOPBAR_H - 26), $SIZE, ($SIZE - 34))
    $g.DrawString($text, $font, $brush, $rect, $fmt)
    $font.Dispose(); $brush.Dispose(); $fmt.Dispose()
}

function Draw-SpeakerGlyph($g, $pen, $brush, $cx, $cy, $mode) {
    $body = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx-64,$cy-16),[System.Drawing.Point]::new($cx-36,$cy-16),[System.Drawing.Point]::new($cx,$cy-50),[System.Drawing.Point]::new($cx,$cy+50),[System.Drawing.Point]::new($cx-36,$cy+16),[System.Drawing.Point]::new($cx-64,$cy+16))
    $g.FillPolygon($brush, $body)
    switch ($mode) {
        "slash" { $pen.Width = 16; $g.DrawLine($pen, ($cx-70), ($cy-58), ($cx+70), ($cy+58)) }
        "plus"  { $g.DrawLine($pen, ($cx+30), $cy, ($cx+70), $cy); $g.DrawLine($pen, ($cx+50), ($cy-20), ($cx+50), ($cy+20)) }
        "minus" { $g.DrawLine($pen, ($cx+30), $cy, ($cx+70), $cy) }
        "waves" {
            $pen.Width = 10
            $g.DrawArc($pen, ($cx+20), ($cy-30), 50, 60, -50, 100)
            $g.DrawArc($pen, ($cx+40), ($cy-42), 74, 84, -50, 100)
        }
    }
}

function Draw-Glyph($g, [string]$shape, [bool]$muted) {
    $c = if ($muted) { $MUTED_COLOR } else { $WHITE }
    $pen = New-Object System.Drawing.Pen($c, 14)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $brush = New-Object System.Drawing.SolidBrush($c)
    $cx = [int]($SIZE / 2); $cy = [int](($SIZE + $TOPBAR_H - 30) / 2)

    switch ($shape) {
        "padlock" {
            $pen.Width = 18
            $g.DrawArc($pen, ($cx-44), ($cy-70), 88, 100, 180, 180)
            $body = Get-RoundedRectPath ($cx-58) ($cy-14) 116 92 16
            $g.FillPath($brush, $body); $body.Dispose()
        }
        "crop" {
            $r = 70
            foreach ($corner in @(0,1,2,3)) {
                $sx = if ($corner -in 0,3) { $cx-$r } else { $cx+$r }
                $sy = if ($corner -in 0,1) { $cy-$r } else { $cy+$r }
                $dx = if ($corner -in 0,3) { 34 } else { -34 }
                $dy = if ($corner -in 0,1) { 34 } else { -34 }
                $g.DrawLine($pen, $sx, $sy, ($sx+$dx), $sy)
                $g.DrawLine($pen, $sx, $sy, $sx, ($sy+$dy))
            }
        }
        "clipboard" {
            $body = Get-RoundedRectPath ($cx-52) ($cy-64) 104 128 14
            $g.DrawPath($pen, $body); $body.Dispose()
            $tab = Get-RoundedRectPath ($cx-22) ($cy-78) 44 24 8
            $g.FillPath($brush, $tab); $tab.Dispose()
            foreach ($i in 0,1,2) { $g.DrawLine($pen, ($cx-30), ($cy-16+$i*28), ($cx+30), ($cy-16+$i*28)) }
        }
        "speaker-mute"  { Draw-SpeakerGlyph $g $pen $brush $cx $cy "slash" }
        "speaker-plus"  { Draw-SpeakerGlyph $g $pen $brush $cx $cy "plus" }
        "speaker-minus" { Draw-SpeakerGlyph $g $pen $brush $cx $cy "minus" }
        "speaker-out"   { Draw-SpeakerGlyph $g $pen $brush $cx $cy "waves" }
        "camera-off" {
            $body = Get-RoundedRectPath ($cx-70) ($cy-38) 108 76 14
            $g.FillPath($brush, $body); $body.Dispose()
            $lens = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx+38,$cy-22),[System.Drawing.Point]::new($cx+78,$cy-40),[System.Drawing.Point]::new($cx+78,$cy+40),[System.Drawing.Point]::new($cx+38,$cy+22))
            $g.FillPolygon($brush, $lens)
            $g.DrawLine($pen, ($cx-80), ($cy-60), ($cx+80), ($cy+60))
        }
        "moon" {
            $g.FillEllipse($brush, ($cx-58), ($cy-58), 116, 116)
            $cutBrush = New-Object System.Drawing.SolidBrush($BASE_BG)
            $g.FillEllipse($cutBrush, ($cx-34), ($cy-66), 116, 116)
            $cutBrush.Dispose()
        }
        "shield" {
            $pts = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx,$cy-70),[System.Drawing.Point]::new($cx+56,$cy-46),[System.Drawing.Point]::new($cx+56,$cy+16),[System.Drawing.Point]::new($cx,$cy+70),[System.Drawing.Point]::new($cx-56,$cy+16),[System.Drawing.Point]::new($cx-56,$cy-46))
            $g.FillPolygon($brush, $pts)
        }
        "shield-check" {
            $pts = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx,$cy-70),[System.Drawing.Point]::new($cx+56,$cy-46),[System.Drawing.Point]::new($cx+56,$cy+16),[System.Drawing.Point]::new($cx,$cy+70),[System.Drawing.Point]::new($cx-56,$cy+16),[System.Drawing.Point]::new($cx-56,$cy-46))
            $g.FillPolygon($brush, $pts)
            $checkPen = New-Object System.Drawing.Pen($BASE_BG, 14)
            $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $g.DrawLine($checkPen, ($cx-28), ($cy-2), ($cx-8), ($cy+20))
            $g.DrawLine($checkPen, ($cx-8), ($cy+20), ($cx+30), ($cy-24))
            $checkPen.Dispose()
        }
        "shield-slash" {
            $pts = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx,$cy-70),[System.Drawing.Point]::new($cx+56,$cy-46),[System.Drawing.Point]::new($cx+56,$cy+16),[System.Drawing.Point]::new($cx,$cy+70),[System.Drawing.Point]::new($cx-56,$cy+16),[System.Drawing.Point]::new($cx-56,$cy-46))
            $g.FillPolygon($brush, $pts)
            $slashPen = New-Object System.Drawing.Pen($BASE_BG, 14)
            $slashPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $slashPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $g.DrawLine($slashPen, ($cx-38), ($cy-42), ($cx+38), ($cy+42))
            $slashPen.Dispose()
        }
        "check" {
            $pen.Width = 22
            $g.DrawLine($pen, ($cx-50), $cy, ($cx-12), ($cy+40))
            $g.DrawLine($pen, ($cx-12), ($cy+40), ($cx+56), ($cy-44))
        }
        "checkbox-list" {
            foreach ($i in 0,1,2) {
                $y = $cy - 46 + $i*46
                $box = Get-RoundedRectPath ($cx-62) ($y-16) 32 32 8
                $g.DrawPath($pen, $box); $box.Dispose()
                $pen2 = New-Object System.Drawing.Pen($c, 7)
                $pen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                $pen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
                $g.DrawLine($pen2, ($cx-55), ($y+1), ($cx-48), ($y+7))
                $g.DrawLine($pen2, ($cx-48), ($y+7), ($cx-38), ($y-8))
                $pen2.Dispose()
                $g.DrawLine($pen, ($cx-14), $y, ($cx+62), $y)
            }
        }
        "restart" {
            $pen.Width = 20
            $g.DrawArc($pen, ($cx-56), ($cy-56), 112, 112, -55, 300)
            $tip = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx+34,$cy-72),[System.Drawing.Point]::new($cx+78,$cy-50),[System.Drawing.Point]::new($cx+36,$cy-26))
            $g.FillPolygon($brush, $tip)
        }
        "list" {
            foreach ($i in 0,1,2) {
                $y = $cy - 50 + $i*50
                $g.FillEllipse($brush, ($cx-58), ($y-8), 16, 16)
                $g.DrawLine($pen, ($cx-28), $y, ($cx+58), $y)
            }
        }
        "envelope" {
            $body = Get-RoundedRectPath ($cx-70) ($cy-46) 140 92 10
            $g.DrawPath($pen, $body); $body.Dispose()
            $g.DrawLine($pen, ($cx-64), ($cy-40), $cx, $cy)
            $g.DrawLine($pen, $cx, $cy, ($cx+64), ($cy-40))
        }
        "book" {
            $g.DrawLine($pen, $cx, ($cy-56), $cx, ($cy+56))
            $left = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx,$cy-56),[System.Drawing.Point]::new($cx-64,$cy-44),[System.Drawing.Point]::new($cx-64,$cy+48),[System.Drawing.Point]::new($cx,$cy+56))
            $g.DrawLines($pen, $left)
            $right = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx,$cy-56),[System.Drawing.Point]::new($cx+64,$cy-44),[System.Drawing.Point]::new($cx+64,$cy+48),[System.Drawing.Point]::new($cx,$cy+56))
            $g.DrawLines($pen, $right)
        }
        "folder" {
            # Tab overlaps far enough past the body's top-left corner radius that the two
            # shapes union cleanly instead of leaving a notch on the left edge.
            $tab = Get-RoundedRectPath ($cx-66) ($cy-54) 74 38 9
            $g.FillPath($brush, $tab); $tab.Dispose()
            $body = Get-RoundedRectPath ($cx-66) ($cy-32) 132 88 13
            $g.FillPath($brush, $body); $body.Dispose()
        }
        "play" {
            $tri = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx-36,$cy-58),[System.Drawing.Point]::new($cx-36,$cy+58),[System.Drawing.Point]::new($cx+60,$cy))
            $g.FillPolygon($brush, $tri)
        }
        "play-pause" {
            # Left half: play triangle (smaller, shifted left)
            $tri = [System.Drawing.Point[]]@(
                [System.Drawing.Point]::new($cx-64,$cy-44),
                [System.Drawing.Point]::new($cx-64,$cy+44),
                [System.Drawing.Point]::new($cx-12,$cy)
            )
            $g.FillPolygon($brush, $tri)
            # Right half: two pause bars
            $barW = 20; $barH = 88; $gap = 14
            $lx = $cx + 8; $rx = $lx + $barW + $gap
            $g.FillRectangle($brush, $lx, ($cy - $barH/2), $barW, $barH)
            $g.FillRectangle($brush, $rx, ($cy - $barH/2), $barW, $barH)
        }
        "terminal" {
            $body = Get-RoundedRectPath ($cx-72) ($cy-56) 144 112 14
            $g.DrawPath($pen, $body); $body.Dispose()
            $pen.Width = 13
            $g.DrawLine($pen, ($cx-40), ($cy-18), ($cx-16), $cy)
            $g.DrawLine($pen, ($cx-16), $cy, ($cx-40), ($cy+18))
            $g.DrawLine($pen, ($cx+2), ($cy+20), ($cx+42), ($cy+20))
        }
        "stop" {
            $body = Get-RoundedRectPath ($cx-52) ($cy-52) 104 104 16
            $g.FillPath($brush, $body); $body.Dispose()
        }
        "bug" {
            $g.FillEllipse($brush, ($cx-42), ($cy-34), 84, 84)
            $pen.Width = 12
            foreach ($i in @(-1, 0, 1)) {
                $g.DrawLine($pen, ($cx-42), ($cy+8+$i*26), ($cx-76), ($cy-4+$i*30))
                $g.DrawLine($pen, ($cx+42), ($cy+8+$i*26), ($cx+76), ($cy-4+$i*30))
            }
            $g.DrawLine($pen, ($cx-20), ($cy-44), ($cx-34), ($cy-72))
            $g.DrawLine($pen, ($cx+20), ($cy-44), ($cx+34), ($cy-72))
        }
        "pencil-note" {
            $body = Get-RoundedRectPath ($cx-56) ($cy-56) 112 112 12
            $g.DrawPath($pen, $body); $body.Dispose()
            $pen.Width = 16
            $g.DrawLine($pen, ($cx-24), ($cy+24), ($cx+34), ($cy-34))
        }
        "arrow-left" {
            $pen.Width = 22
            $g.DrawLine($pen, ($cx+52), $cy, ($cx-48), $cy)
            $g.DrawLine($pen, ($cx-48), $cy, ($cx-10), ($cy-38))
            $g.DrawLine($pen, ($cx-48), $cy, ($cx-10), ($cy+38))
        }
        # --- Meeting glyphs (MuteDeck) ---
        "microphone" {
            # Pill-shaped mic capsule + stand
            $capW = 52; $capH = 76
            $capPath = Get-RoundedRectPath ($cx - $capW/2) ($cy - 54) $capW $capH ($capW/2)
            $g.FillPath($brush, $capPath); $capPath.Dispose()
            $pen.Width = 12
            $g.DrawArc($pen, ($cx-40), ($cy-20), 80, 80, 0, 180)
            $g.DrawLine($pen, $cx, ($cy+60), $cx, ($cy+74))
            $g.DrawLine($pen, ($cx-28), ($cy+74), ($cx+28), ($cy+74))
        }
        "microphone-slash" {
            $capW = 52; $capH = 76
            $capPath = Get-RoundedRectPath ($cx - $capW/2) ($cy - 54) $capW $capH ($capW/2)
            $g.FillPath($brush, $capPath); $capPath.Dispose()
            $pen.Width = 12
            $g.DrawArc($pen, ($cx-40), ($cy-20), 80, 80, 0, 180)
            $g.DrawLine($pen, $cx, ($cy+60), $cx, ($cy+74))
            $g.DrawLine($pen, ($cx-28), ($cy+74), ($cx+28), ($cy+74))
            # Diagonal slash
            $pen.Width = 16
            $g.DrawLine($pen, ($cx-60), ($cy-68), ($cx+60), ($cy+68))
        }
        "camera-on" {
            $body = Get-RoundedRectPath ($cx-70) ($cy-38) 108 76 14
            $g.FillPath($brush, $body); $body.Dispose()
            $lens = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx+38,$cy-22),[System.Drawing.Point]::new($cx+78,$cy-40),[System.Drawing.Point]::new($cx+78,$cy+40),[System.Drawing.Point]::new($cx+38,$cy+22))
            $g.FillPolygon($brush, $lens)
        }
        "camera-slash" {
            $body = Get-RoundedRectPath ($cx-70) ($cy-38) 108 76 14
            $g.FillPath($brush, $body); $body.Dispose()
            $lens = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx+38,$cy-22),[System.Drawing.Point]::new($cx+78,$cy-40),[System.Drawing.Point]::new($cx+78,$cy+40),[System.Drawing.Point]::new($cx+38,$cy+22))
            $g.FillPolygon($brush, $lens)
            $pen.Width = 16
            $g.DrawLine($pen, ($cx-80), ($cy-60), ($cx+80), ($cy+60))
        }
        "screen" {
            # Monitor shape
            $body = Get-RoundedRectPath ($cx-72) ($cy-54) 144 96 10
            $g.DrawPath($pen, $body); $body.Dispose()
            $g.DrawLine($pen, $cx, ($cy+42), $cx, ($cy+60))
            $g.DrawLine($pen, ($cx-36), ($cy+60), ($cx+36), ($cy+60))
            # Up-arrow inside (sharing)
            $pen.Width = 10
            $g.DrawLine($pen, $cx, ($cy-30), $cx, ($cy+18))
            $g.DrawLine($pen, ($cx-18), ($cy-12), $cx, ($cy-30))
            $g.DrawLine($pen, ($cx+18), ($cy-12), $cx, ($cy-30))
        }
        "screen-slash" {
            $body = Get-RoundedRectPath ($cx-72) ($cy-54) 144 96 10
            $g.DrawPath($pen, $body); $body.Dispose()
            $g.DrawLine($pen, $cx, ($cy+42), $cx, ($cy+60))
            $g.DrawLine($pen, ($cx-36), ($cy+60), ($cx+36), ($cy+60))
            $pen.Width = 16
            $g.DrawLine($pen, ($cx-80), ($cy-60), ($cx+80), ($cy+60))
        }
        "record" {
            # Large filled circle
            $g.FillEllipse($brush, ($cx-48), ($cy-48), 96, 96)
        }
        "record-slash" {
            $g.FillEllipse($brush, ($cx-48), ($cy-48), 96, 96)
            $pen.Width = 16
            $g.DrawLine($pen, ($cx-60), ($cy-60), ($cx+60), ($cy+60))
        }
        "phone-hang" {
            # Phone receiver rotated / hanging up
            $pen.Width = 18
            $g.DrawArc($pen, ($cx-56), ($cy-20), 112, 80, 180, 180)
            # Earpiece/mouthpiece ends
            $g.FillRectangle($brush, ($cx-66), ($cy-18), 28, 44)
            $g.FillRectangle($brush, ($cx+38), ($cy-18), 28, 44)
        }
        "hand" {
            # Simplified raised hand
            $pen.Width = 12
            # Palm
            $palm = Get-RoundedRectPath ($cx-36) ($cy-20) 72 86 20
            $g.FillPath($brush, $palm); $palm.Dispose()
            # Fingers (3 lines up)
            $g.DrawLine($pen, ($cx-16), ($cy-20), ($cx-16), ($cy-62))
            $g.DrawLine($pen, ($cx+4), ($cy-20), ($cx+4), ($cy-68))
            $g.DrawLine($pen, ($cx+24), ($cy-20), ($cx+24), ($cy-58))
            # Thumb
            $g.DrawLine($pen, ($cx-36), ($cy-6), ($cx-54), ($cy-28))
        }
        "chat" {
            # Speech bubble
            $body = Get-RoundedRectPath ($cx-66) ($cy-56) 132 96 22
            $g.FillPath($brush, $body); $body.Dispose()
            # Tail
            $tail = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx-20,$cy+40),[System.Drawing.Point]::new($cx-44,$cy+72),[System.Drawing.Point]::new($cx+8,$cy+40))
            $g.FillPolygon($brush, $tail)
        }
        "heart" {
            # Two arcs + triangle
            $g.FillEllipse($brush, ($cx-52), ($cy-44), 56, 56)
            $g.FillEllipse($brush, ($cx-4), ($cy-44), 56, 56)
            $tri = [System.Drawing.Point[]]@([System.Drawing.Point]::new($cx-54,$cy-8),[System.Drawing.Point]::new($cx+54,$cy-8),[System.Drawing.Point]::new($cx,$cy+62))
            $g.FillPolygon($brush, $tri)
        }
        "thumbs-up" {
            # Thumb
            $pen.Width = 14
            $thumb = Get-RoundedRectPath ($cx-12) ($cy-68) 30 80 14
            $g.FillPath($brush, $thumb); $thumb.Dispose()
            # Fist body
            $fist = Get-RoundedRectPath ($cx-48) ($cy+4) 90 48 14
            $g.FillPath($brush, $fist); $fist.Dispose()
        }
        "push-talk" {
            # Mic with waves (active talk)
            $capW = 44; $capH = 66
            $capPath = Get-RoundedRectPath ($cx - $capW/2) ($cy - 46) $capW $capH ($capW/2)
            $g.FillPath($brush, $capPath); $capPath.Dispose()
            $pen.Width = 10
            $g.DrawArc($pen, ($cx-34), ($cy-16), 68, 68, 0, 180)
            $g.DrawLine($pen, $cx, ($cy+52), $cx, ($cy+64))
            $g.DrawLine($pen, ($cx-22), ($cy+64), ($cx+22), ($cy+64))
            # Sound waves
            $pen.Width = 8
            $g.DrawArc($pen, ($cx+30), ($cy-34), 36, 48, -40, 80)
            $g.DrawArc($pen, ($cx+44), ($cy-42), 48, 64, -40, 80)
        }
        "window-front" {
            # Two overlapping window rectangles
            $back = Get-RoundedRectPath ($cx-62) ($cy-50) 92 72 8
            $g.DrawPath($pen, $back); $back.Dispose()
            $frontBg = New-Object System.Drawing.SolidBrush($BASE_BG)
            $frontCover = Get-RoundedRectPath ($cx-22) ($cy-20) 92 72 8
            $g.FillPath($frontBg, $frontCover); $frontCover.Dispose()
            $frontBg.Dispose()
            $front = Get-RoundedRectPath ($cx-22) ($cy-20) 92 72 8
            $g.FillPath($brush, $front); $front.Dispose()
        }
        "headset" {
            # Headphone arc + ear cups
            $pen.Width = 16
            $g.DrawArc($pen, ($cx-52), ($cy-60), 104, 96, 180, 180)
            $g.FillRectangle($brush, ($cx-60), ($cy-10), 24, 52)
            $g.FillRectangle($brush, ($cx+36), ($cy-10), 24, 52)
        }
        "battery" {
            $body = Get-RoundedRectPath ($cx-72) ($cy-40) 132 80 12
            $g.DrawPath($pen, $body); $body.Dispose()
            $nub = Get-RoundedRectPath ($cx+60) ($cy-16) 18 32 6
            $g.FillPath($brush, $nub); $nub.Dispose()
            $g.FillRectangle($brush, ($cx-58), ($cy-26), 76, 52)
        }
        "bluetooth" {
            $pen.Width = 14
            $pts = @(
                [System.Drawing.Point]::new($cx, $cy-56), [System.Drawing.Point]::new($cx, $cy+56)
            )
            $g.DrawLine($pen, $pts[0], $pts[1])
            $g.DrawLine($pen, ($cx), ($cy-56), ($cx+38), ($cy+22))
            $g.DrawLine($pen, ($cx+38), ($cy-22), ($cx), ($cy+56))
        }
        "sun" {
            # Circle with rays
            $r = 28
            $g.DrawEllipse($pen, ($cx - $r), ($cy - $r), ($r*2), ($r*2))
            $pen.Width = 10
            $rayLen = 22; $gap = $r + 10
            for ($i = 0; $i -lt 8; $i++) {
                $angle = $i * 45 * [Math]::PI / 180
                $x1 = $cx + [int]([Math]::Cos($angle) * $gap)
                $y1 = $cy + [int]([Math]::Sin($angle) * $gap)
                $x2 = $cx + [int]([Math]::Cos($angle) * ($gap + $rayLen))
                $y2 = $cy + [int]([Math]::Sin($angle) * ($gap + $rayLen))
                $g.DrawLine($pen, $x1, $y1, $x2, $y2)
            }
        }
        "skip-fwd" {
            # Two triangles + bar (next track)
            $pen.Width = 12
            $pts1 = @([System.Drawing.Point]::new($cx-50,$cy-44), [System.Drawing.Point]::new($cx,$cy), [System.Drawing.Point]::new($cx-50,$cy+44))
            $g.FillPolygon($brush, $pts1)
            $pts2 = @([System.Drawing.Point]::new($cx,$cy-44), [System.Drawing.Point]::new($cx+50,$cy), [System.Drawing.Point]::new($cx,$cy+44))
            $g.FillPolygon($brush, $pts2)
            $g.DrawLine($pen, ($cx+50), ($cy-44), ($cx+50), ($cy+44))
        }
        "skip-back" {
            # Bar + two triangles (previous track)
            $pen.Width = 12
            $pts1 = @([System.Drawing.Point]::new($cx+50,$cy-44), [System.Drawing.Point]::new($cx,$cy), [System.Drawing.Point]::new($cx+50,$cy+44))
            $g.FillPolygon($brush, $pts1)
            $pts2 = @([System.Drawing.Point]::new($cx,$cy-44), [System.Drawing.Point]::new($cx-50,$cy), [System.Drawing.Point]::new($cx,$cy+44))
            $g.FillPolygon($brush, $pts2)
            $g.DrawLine($pen, ($cx-50), ($cy-44), ($cx-50), ($cy+44))
        }
    }
    $pen.Dispose(); $brush.Dispose()
}

function Save-Icon($canvas, [string]$outPath) {
    New-Item -ItemType Directory -Path (Split-Path $outPath) -Force | Out-Null
    $canvas.Bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.G.Dispose(); $canvas.Bmp.Dispose()
}
