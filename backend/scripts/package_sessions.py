"""Package only application code and profiles for Lambda; no AWS calls."""
import hashlib
from pathlib import Path
import zipfile

BACKEND = Path(__file__).resolve().parent.parent


def package():
    output = BACKEND / "work" / "sessions-lambda.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for directory, suffix in (("app", ".py"), ("data/profiles", ".json")):
            for path in sorted((BACKEND / directory).rglob("*" + suffix)):
                entry = zipfile.ZipInfo(path.relative_to(BACKEND).as_posix(), (2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, path.read_bytes())
    return output


if __name__ == "__main__":
    output = package()
    print(f"Package: {output}")
    print(f"SHA256: {hashlib.sha256(output.read_bytes()).hexdigest()}")
