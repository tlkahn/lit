"""
Unit tests for the URL normalization logic in generate-acknowledgements.sh.

The embedded Python in that script normalizes npm repository URLs by stripping
'git+' prefixes, replacing 'git://' with 'https://', and removing a trailing
'.git' suffix.  The correct method for suffix removal is str.removesuffix(),
NOT str.rstrip() (which treats its argument as a character set).
"""

import unittest


def normalize_repo_url(raw: str) -> str:
    """Reproduce the normalization expression from generate-acknowledgements.sh."""
    return raw.replace("git+", "").replace("git://", "https://").removesuffix(".git")


class TestRepoUrlNormalization(unittest.TestCase):
    # -- URLs ending in characters from {'.','g','i','t'} that rstrip would corrupt --

    def test_electron_get(self):
        got = normalize_repo_url("git+https://github.com/electron/get.git")
        self.assertEqual(got, "https://github.com/electron/get")

    def test_jiti(self):
        got = normalize_repo_url("git+https://github.com/unjs/jiti.git")
        self.assertEqual(got, "https://github.com/unjs/jiti")

    def test_ini(self):
        got = normalize_repo_url("git+https://github.com/isaacs/ini.git")
        self.assertEqual(got, "https://github.com/isaacs/ini")

    def test_semver(self):
        """Name ends in 'r', not in the strip set -- should be fine either way."""
        got = normalize_repo_url("git+https://github.com/npm/node-semver.git")
        self.assertEqual(got, "https://github.com/npm/node-semver")

    # -- URLs without .git suffix (no-op expected) --

    def test_no_git_suffix(self):
        got = normalize_repo_url("https://github.com/facebook/react")
        self.assertEqual(got, "https://github.com/facebook/react")

    # -- git:// protocol replacement --

    def test_git_protocol(self):
        got = normalize_repo_url("git://github.com/foo/bar.git")
        self.assertEqual(got, "https://github.com/foo/bar")

    # -- empty / missing --

    def test_empty_string(self):
        self.assertEqual(normalize_repo_url(""), "")


if __name__ == "__main__":
    unittest.main()
