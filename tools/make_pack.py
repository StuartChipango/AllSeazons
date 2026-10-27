#!/usr/bin/env python3
"""Make a "Claude pack" for the All Seazons staff app.

Claude names the toys in chat, writes the labels to a JSON file, and runs:

    python3 make_pack.py labels.json pack.zip

labels.json is a list, one entry per photo, in this shape:

    [{"photo": "/path/to/photo", "tagline": "Pop-up Roof", "name": "Barbie Camper Van", "brand": "Barbie",
      "audience": "girls", "condition": "used", "category": "Dolls & Accessories",
      "age_range": "3-5", "description": "A pink camper with pop-up roof.",
      "price": 75, "confidence": "high"}]

focus is where the toy is in the photo, [left, top, right, bottom] as
fractions of the width/height, covering every part of the toy; the frame
then fills the window without cutting the toy.
tagline is the small thin line above the name on the picture ("" for none).
price is optional (blank = the price picked on the Add toys page).
The pack holds the photos as 001.jpg, 002.jpg... plus labels.csv. In the
staff app: Add toys > Add a Claude pack > pick the .zip.
"""
import csv, io, json, sys, zipfile
from PIL import Image, ImageOps

AUDIENCES = {"boys", "girls", "neutral"}
AGES = {"0-2", "3-5", "6-8", "9+"}
CATEGORIES = {"Dolls & Accessories", "Cars & Vehicles", "Building & Blocks", "Soft Toys",
              "Baby & Toddler", "Puzzles & Games", "Action Figures", "Pretend Play",
              "Learning Toys", "Outdoor & Sports", "Books", "Other"}
COLUMNS = ["file", "tagline", "name", "brand", "audience", "condition", "category", "age_range",
           "description", "price", "confidence", "focus"]


def jpeg(path):
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((1600, 1600))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return out.getvalue()


def main(labels_path, out_path):
    items = json.load(open(labels_path))
    problems = []
    rows = []
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
        for n, item in enumerate(items, 1):
            file = f"{n:03d}.jpg"
            try:
                z.writestr(file, jpeg(item["photo"]))
            except Exception as e:  # noqa: BLE001
                problems.append(f"{item.get('photo')}: not a photo I can open ({e})")
                continue
            row = {c: item.get(c, "") for c in COLUMNS}
            row["file"] = file
            row["name"] = str(row["name"]).strip()[:40] or "Unnamed toy"
            row["tagline"] = str(row["tagline"] or "").strip()[:30]
            focus = item.get("focus")
            if focus:
                ok = isinstance(focus, list) and len(focus) == 4 and all(isinstance(v, (int, float)) for v in focus) \
                    and 0 <= focus[0] < focus[2] <= 1 and 0 <= focus[1] < focus[3] <= 1
                if not ok:
                    problems.append(f"{file}: focus {focus!r} must be [left, top, right, bottom] fractions 0-1")
                row["focus"] = ",".join(f"{v:.3f}" for v in focus) if ok else ""
            if row["audience"] not in AUDIENCES:
                problems.append(f"{file}: audience {row['audience']!r} is not boys/girls/neutral")
            if row["condition"] not in {"used", "new"}:
                problems.append(f"{file}: condition {row['condition']!r} is not used/new")
            if row["category"] not in CATEGORIES:
                problems.append(f"{file}: category {row['category']!r} is not in the shop's list")
            if row["age_range"] not in AGES:
                problems.append(f"{file}: age_range {row['age_range']!r} is not one of {sorted(AGES)}")
            rows.append(row)
        text = io.StringIO()
        w = csv.DictWriter(text, COLUMNS, lineterminator="\r\n")
        w.writeheader()
        w.writerows(rows)
        z.writestr("labels.csv", text.getvalue())
    print(f"{out_path}: {len(rows)} toys")
    for p in problems:
        print("CHECK:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
