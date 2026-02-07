#!/bin/bash

# Script to generate all favicon and icon sizes from SVG sources
# Requires: ImageMagick or rsvg-convert (librsvg)

set -e

echo "Generating icons from SVG sources..."

# Check for required tools
if command -v rsvg-convert &> /dev/null; then
    CONVERTER="rsvg"
    echo "Using rsvg-convert"
elif command -v magick &> /dev/null; then
    CONVERTER="magick"
    echo "Using ImageMagick"
elif command -v convert &> /dev/null; then
    CONVERTER="imagemagick"
    echo "Using ImageMagick (legacy)"
else
    echo "Error: Neither rsvg-convert nor ImageMagick found"
    echo "Install with: brew install librsvg (or imagemagick)"
    exit 1
fi

# Function to convert SVG to PNG
convert_svg() {
    local input=$1
    local output=$2
    local size=$3
    
    if [ "$CONVERTER" = "rsvg" ]; then
        rsvg-convert -w $size -h $size "$input" -o "$output"
    elif [ "$CONVERTER" = "magick" ]; then
        magick convert -background none -resize ${size}x${size} "$input" "$output"
    else
        convert -background none -resize ${size}x${size} "$input" "$output"
    fi
    
    echo "✓ Generated $output"
}

# Generate favicons
convert_svg "favicon.svg" "favicon-16x16.png" 16
convert_svg "favicon.svg" "favicon-32x32.png" 32

# Generate PWA icons
convert_svg "icon.svg" "icon-192.png" 192
convert_svg "icon.svg" "icon-512.png" 512

# Generate Apple touch icons
convert_svg "apple-touch-icon.svg" "apple-touch-icon.png" 180
convert_svg "apple-touch-icon.svg" "apple-touch-icon-120x120.png" 120
convert_svg "apple-touch-icon.svg" "apple-touch-icon-152x152.png" 152
convert_svg "apple-touch-icon.svg" "apple-touch-icon-180x180.png" 180

# Generate OG image
convert_svg "og-image.svg" "og-image.png" 1200

# Generate favicon.ico (multi-size)
if [ "$CONVERTER" = "magick" ]; then
    magick convert favicon-16x16.png favicon-32x32.png favicon.ico
elif command -v convert &> /dev/null; then
    convert favicon-16x16.png favicon-32x32.png favicon.ico
else
    echo "⚠ Skipping favicon.ico (requires ImageMagick)"
fi

echo ""
echo "✅ All icons generated successfully!"
echo ""
echo "Generated files:"
echo "  - favicon.ico"
echo "  - favicon-16x16.png"
echo "  - favicon-32x32.png"
echo "  - favicon.svg"
echo "  - icon-192.png"
echo "  - icon-512.png"
echo "  - apple-touch-icon.png"
echo "  - apple-touch-icon-*.png"
echo "  - og-image.png"
