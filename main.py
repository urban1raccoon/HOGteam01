
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "digital-twin" / "backend"
BACKEND_MAIN = BACKEND_DIR / "main.py"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

spec = spec_from_file_location("backend_main", BACKEND_MAIN)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load backend app from: {BACKEND_MAIN}")

backend_main = module_from_spec(spec)
spec.loader.exec_module(backend_main)
app = backend_main.app

