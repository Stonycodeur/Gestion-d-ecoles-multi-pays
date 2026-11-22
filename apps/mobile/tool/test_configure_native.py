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

    def test_xr_android_is_local_cleartext_only_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / "android/app/src/main").mkdir(parents=True); (root / "android/app/src/main/AndroidManifest.xml").write_text(MANIFEST)
            for _ in range(2):
                self.assertTrue(c.patch_android_xr(root))
            xml = (root / "android/app/src/main/AndroidManifest.xml").read_text()
            self.assertEqual(xml.count("android:networkSecurityConfig"), 1); self.assertEqual(xml.count("<queries>"), 1)
            cfg = (root / "android/app/src/main/res/xml/network_security_config.xml").read_text()
            self.assertIn('<base-config cleartextTrafficPermitted="false"/>', cfg); self.assertIn("localhost", cfg)

    def test_missing_platform_folders(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(c.patch_android(Path(d))); self.assertFalse(c.patch_ios(Path(d)))

KTS = 'plugins { id("com.android.application") }\n\nandroid {\n    namespace = "x"\n    defaultConfig {\n        applicationId = "com.example.x"\n    }\n    buildTypes {\n        release {\n            signingConfig = signingConfigs.getByName("debug")\n        }\n    }\n}\n'
GROOVY = 'plugins { id "com.android.application" }\n\nandroid {\n    defaultConfig {\n        applicationId "com.example.x"\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }\n    }\n}\n'
PBX = 'buildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.x;\n\t\t\t};\nbuildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.x.RunnerTests;\n\t\t\t};\n'


class Release(unittest.TestCase):
    def _android(self, name, text):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / "android/app").mkdir(parents=True); f = root / "android/app" / name; f.write_text(text)
            for _ in range(2):
                self.assertTrue(c.patch_android_signing(root, "com.ecole.pro"))
            return f.read_text()

    def test_kts_signing_reads_key_properties_and_is_idempotent(self):
        g = self._android("build.gradle.kts", KTS)
        self.assertEqual(g.count("key.properties"), 1); self.assertIn('create("release")', g); self.assertIn('applicationId = "com.ecole.pro"', g)
        self.assertIn('if (keystoreProperties.containsKey("storeFile")) signingConfigs.getByName("release") else signingConfigs.getByName("debug")', g)
        self.assertNotIn("storePassword = \"", g)   # no secret value is ever written

    def test_groovy_signing(self):
        g = self._android("build.gradle", GROOVY)
        self.assertEqual(g.count("key.properties"), 1); self.assertIn("signingConfigs.release : signingConfigs.debug", g); self.assertIn('applicationId "com.ecole.pro"', g)

    def test_ios_entitlements_only_for_the_runner_target(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / "ios/Runner").mkdir(parents=True); (root / "ios/Runner.xcodeproj").mkdir(); p = root / "ios/Runner.xcodeproj/project.pbxproj"; p.write_text(PBX)
            for _ in range(2):
                self.assertTrue(c.patch_ios_entitlements(root, "com.ecole.pro"))
            t = p.read_text()
            self.assertEqual(t.count("CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;"), 1); self.assertIn("PRODUCT_BUNDLE_IDENTIFIER = com.ecole.pro;", t)
            self.assertIn("com.example.x.RunnerTests;", t)
            self.assertEqual(plistlib.loads((root / "ios/Runner/Runner.entitlements").read_bytes()), {"aps-environment": "production"})

    def test_missing_folders(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(c.patch_android_signing(Path(d))); self.assertFalse(c.patch_ios_entitlements(Path(d)))


if __name__ == "__main__":
    unittest.main()
