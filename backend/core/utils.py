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