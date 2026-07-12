"""Small shared helpers."""

import subprocess


def run(cmd, timeout=5):
    """Run a command, returning stdout or an 'ERROR: ...' string on failure.

    Deliberately swallows exceptions rather than raising — callers treat
    the string prefix as the failure signal so a single bad command never
    takes down the whole /api/status response.
    """
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout
    except Exception as e:
        return f"ERROR: {e}"


def run_checked(cmd, timeout=5):
    """Like run(), but returns the full CompletedProcess (or None if the
    command couldn't even be launched, or timed out) instead of only ever
    returning stdout. Use this anywhere a silent non-zero exit would
    otherwise be indistinguishable from success — run() alone throws away
    returncode and stderr, which turns real failures into confusing
    empty/missing output downstream."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None