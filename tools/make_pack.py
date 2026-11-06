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

With `pip install "rembg[cpu]" opencv-python-headless` (models download from
GitHub on first use) each photo also gets 001-cut.png (the toy cut out) and
001-plate.jpg (the photo with the toy painted out), and focus is measured
from the cutout when not given. The frame then fills the window, lets tall
toys pop out over the frame, and carries the table on past the photo edges.
Without them the pack still works; pass --no-cutouts to skip.
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


def photo(path):
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((1600, 1600))
    return img


def jpeg(img, quality=88):
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality)
    return out.getvalue()


_session = None


def cutout(img):
    """(cut PNG bytes, plate JPEG bytes, focus) or None if the tools are missing."""
    global _session
    try:
        import cv2
        import numpy as np
        from rembg import new_session, remove
    except ImportError:
        return None
    if _session is None:
        _session = new_session("u2net")
    small = img.copy()
    small.thumbnail((1024, 1024))
    mask = remove(small, session=_session, only_mask=True)
    box = mask.point(lambda v: 255 if v > 128 else 0).getbbox()
    if not box:
        return None
    w, h = small.size
    pad = 0.01
    focus = [max(0, box[0] / w - pad), max(0, box[1] / h - pad), min(1, box[2] / w + pad), min(1, box[3] / h + pad)]
    cut = Image.new("LA", small.size, (255, 0))
    cut.putalpha(mask)
    cut_png = io.BytesIO()
    cut.save(cut_png, "PNG", optimize=True)
    # Paint the toy out: inpaint a small copy, blend it in over a widened mask.
    arr = np.array(small)
    m = (np.array(mask) > 40).astype(np.uint8) * 255
    m = cv2.dilate(m, np.ones((31, 31), np.uint8))
    tiny = cv2.inpaint(cv2.resize(arr, (256, 256)), cv2.resize(m, (256, 256)), 9, cv2.INPAINT_TELEA)
    fill = cv2.resize(tiny, (w, h), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(m, (31, 31), 0)[..., None] / 255.0
    plate = Image.fromarray((arr * (1 - soft) + fill * soft).astype(np.uint8))
    return cut_png.getvalue(), jpeg(plate, 85), [round(v, 3) for v in focus]


def main(labels_path, out_path, cutouts=True):
    items = json.load(open(labels_path))
    problems = []
    rows = []
    cut_count = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
        for n, item in enumerate(items, 1):
            file = f"{n:03d}.jpg"
            try:
                img = photo(item["photo"])
            except Exception as e:  # noqa: BLE001
                problems.append(f"{item.get('photo')}: not a photo I can open ({e})")
                continue
            z.writestr(file, jpeg(img))
            extra = cutout(img) if cutouts else None
            if extra:
                cut_png, plate_jpg, measured = extra
                z.writestr(f"{n:03d}-cut.png", cut_png)
                z.writestr(f"{n:03d}-plate.jpg", plate_jpg)
                if not item.get("focus"):
                    item = {**item, "focus": measured}
                cut_count += 1
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
    print(f"{out_path}: {len(rows)} toys, {cut_count} with cutouts")
    if cutouts and cut_count < len(rows):
        print("NOTE: some photos have no cutout (rembg/opencv missing or no toy found); they still work.")
    for p in problems:
        print("CHECK:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--no-cutouts"]
    if len(args) != 2:
        sys.exit(__doc__)
    sys.exit(main(args[0], args[1], cutouts="--no-cutouts" not in sys.argv))
