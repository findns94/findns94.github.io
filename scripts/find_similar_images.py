#!/usr/bin/env python3
"""
Find similar/duplicate images using perceptual hashing.
Usage: python3 scripts/find_similar_images.py [directory] [threshold]
Default: directory=public/posts, threshold=10 (MSE)
"""

import os
import sys
from PIL import Image

def average_hash(img, hash_size=16):
    """Compute average hash of an image."""
    img = img.resize((hash_size, hash_size)).convert('L')
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    return ''.join('1' if p > avg else '0' for p in pixels)

def mse_similarity(img1, img2, size=(64, 64)):
    """Compute MSE between two images after resizing."""
    r1 = img1.resize(size).convert('L')
    r2 = img2.resize(size).convert('L')
    p1 = list(r1.getdata())
    p2 = list(r2.getdata())
    return sum((a - b) ** 2 for a, b in zip(p1, p2)) / len(p1)

def hamming_distance(hash1, hash2):
    """Count differing bits between two hashes."""
    return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))

def find_images(directory):
    """Find all image files in directory recursively."""
    images = []
    for root, dirs, files in os.walk(directory):
        for f in files:
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                images.append(os.path.join(root, f))
    return sorted(images)

def main():
    directory = sys.argv[1] if len(sys.argv) > 1 else 'public/posts'
    mse_threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 10
    hash_threshold = int(sys.argv[3]) if len(sys.argv) > 3 else 10

    images = find_images(directory)
    print(f"Found {len(images)} images in {directory}")
    print(f"Thresholds: MSE < {mse_threshold}, hash distance < {hash_threshold}")
    print()

    # Compute hashes for all images
    hashes = {}
    for path in images:
        try:
            img = Image.open(path)
            hashes[path] = {
                'hash': average_hash(img),
                'img': img,
                'size': os.path.getsize(path)
            }
        except Exception as e:
            print(f"Error reading {path}: {e}")

    # Compare all pairs
    paths = list(hashes.keys())
    duplicates = []
    similar = []

    for i in range(len(paths)):
        for j in range(i + 1, len(paths)):
            p1, p2 = paths[i], paths[j]
            h1, h2 = hashes[p1]['hash'], hashes[p2]['hash']
            dist = hamming_distance(h1, h2)

            if dist < hash_threshold:
                mse = mse_similarity(hashes[p1]['img'], hashes[p2]['img'])
                if mse < mse_threshold:
                    duplicates.append((p1, p2, mse, dist))
                else:
                    similar.append((p1, p2, mse, dist))

    # Report results
    if duplicates:
        print(f"=== EXACT DUPLICATES ({len(duplicates)} pairs) ===")
        for p1, p2, mse, dist in duplicates:
            print(f"  MSE={mse:.1f}, hash_diff={dist}")
            print(f"    {p1} ({hashes[p1]['size']/1024:.0f}KB)")
            print(f"    {p2} ({hashes[p2]['size']/1024:.0f}KB)")
        print()

    if similar:
        print(f"=== SIMILAR IMAGES ({len(similar)} pairs) ===")
        for p1, p2, mse, dist in similar:
            print(f"  MSE={mse:.1f}, hash_diff={dist}")
            print(f"    {p1}")
            print(f"    {p2}")
        print()

    if not duplicates and not similar:
        print("No similar images found!")

if __name__ == '__main__':
    main()
