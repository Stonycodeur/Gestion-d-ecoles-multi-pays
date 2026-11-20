import plistlib, tempfile, unittest
from pathlib import Path
import configure_native as c

MANIFEST = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="x"/>\n</manifest>\n'

class T(unittest.TestCase):
    def test_idempotent_android_and_ios(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "android/app/src/main").mkdir(parents=True); (root / "android/app/src/main/AndroidManifest.xml").write_text(MANIFEST)
            (root / "ios/Runner").mkdir(parents=True); (root / "ios/Runner/Info.plist").write_bytes(plistlib.dumps({"UIBackgroundModes": ["fetch"]}))
            for _ in range(2):
                self.assertTrue(c.patch_android(root)); self.assertTrue(c.patch_ios(root))
            xml = (root / "android/app/src/main/AndroidManifest.xml").read_text()
            for p in c.ANDROID_PERMISSIONS:
                self.assertEqual(xml.count(f'android:name="{p}"'), 1)
            plist = plistlib.loads((root / "ios/Runner/Info.plist").read_bytes())
            self.assertEqual(plist["UIBackgroundModes"], ["fetch", "location", "remote-notification"])
            self.assertIn("NSLocationAlwaysAndWhenInUseUsageDescription", plist)

    def test_missing_platform_folders(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(c.patch_android(Path(d))); self.assertFalse(c.patch_ios(Path(d)))

if __name__ == "__main__":
    unittest.main()
