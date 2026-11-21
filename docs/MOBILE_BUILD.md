# Building the Android APK (Samsung Galaxy A22 4G)

Expo Go is **not** the APK. EAS builds a standalone APK in Expo's cloud; you need a free Expo account (https://expo.dev).

```bash
cd mobile
npm install
npx expo install --fix            # aligns package versions with the installed Expo SDK (my pins may be stale)
npx tsc --noEmit                  # type-check
npm install -g eas-cli
eas login
eas init                          # creates the EAS project and writes projectId
eas build --platform android --profile preview     # → downloadable .apk
```
Download the APK from the build page, copy it to the phone, allow "install unknown apps", install.
Min Android 7 (API 24); A22 4G runs Android 11+. App id: `com.itzbot.manager`.

* HTTPS server (recommended): profile `preview`. Cleartext HTTP is blocked in that build.
* Plain-HTTP test server only: `eas build --platform android --profile preview-insecure` (never for real tokens).
* Local dev: `npx expo start` + Expo Go works for the UI, but use a dev/preview build for realistic testing.
* To regenerate icons: `python3 make_assets.py`.
* The app contains **no server address or credentials**; you enter the URL and sign in on first launch.
