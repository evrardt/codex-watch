"""Check that watch translations stay complete and preserve product names."""
from collections import Counter
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent / "wear" / "src" / "main" / "res"
LOCALES = ("", "fr", "en", "de", "es", "pt")
catalogs = {}
for locale in LOCALES:
    folder = "values" + (f"-{locale}" if locale else "")
    strings = ET.parse(ROOT / folder / "strings.xml").getroot().findall("string")
    names = [item.attrib["name"] for item in strings]
    duplicates = [name for name, count in Counter(names).items() if count > 1]
    if duplicates or any(not (item.text or "").strip() for item in strings):
        raise SystemExit(f"Invalid {folder} catalog: duplicate or empty text")
    catalogs[locale] = {item.attrib["name"]: item.text or "" for item in strings}

reference = catalogs["fr"]
brands = ("Codex", "ChatGPT", "Phonon", "OpenAI", "Bluetooth", "Wear OS")
for locale, catalog in catalogs.items():
    if catalog.keys() != reference.keys():
        raise SystemExit(f"Locale {locale or 'default'} has different string keys")
    for name, source in reference.items():
        if Counter(re.findall(r"%(?:\d+\$)?[sd]", source)) != Counter(re.findall(r"%(?:\d+\$)?[sd]", catalog[name])):
            raise SystemExit(f"Locale {locale or 'default'} has different placeholders in {name}")
        for brand in brands:
            if brand.casefold() in source.casefold() and brand.casefold() not in catalog[name].casefold():
                raise SystemExit(f"Locale {locale or 'default'} is missing {brand} in {name}")
if catalogs[""] != catalogs["en"]:
    raise SystemExit("Default watch strings must match the English fallback")
print(f"Watch locales: {len(reference)} matching strings in French, English, German, Spanish and Portuguese")
