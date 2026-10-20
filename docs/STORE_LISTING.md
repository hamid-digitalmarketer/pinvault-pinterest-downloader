# PinVault — Chrome Web Store Listing Copy & Metadata

Use the content below when filling out your store listing in the [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole).

---

## 1. Store Metadata

- **Item Name**: `PinVault — Pinterest Image & Video Downloader`
- **Short Description** *(under 132 characters)*:
  ```text
  Save Pinterest images and videos to your computer. Local-first, private, no tracking. Bulk download with duplicate detection.
  ```
- **Category**: `Photos` or `Productivity`
- **Language**: `English`
- **Official Website**: `https://abouthamid.web.app/`
- **Support URL**: `https://github.com/hamid-digitalmarketer/pinvault-pinterest-downloader/issues`

---

## 2. Detailed Description (Copy & Paste into Store Description)

```text
PinVault is a fast, local-first Chrome extension that lets you save Pinterest images and directly accessible videos in the highest available resolution with smart naming, queue management, duplicate detection, and inventory export.

⭐ KEY FEATURES

• Best Accessible Resolution: Automatically detects highest available image variants on pinimg CDN.
• One-Click Hover Download: Download buttons automatically appear when hovering over pins on Pinterest.
• Quick URL Download: Paste any Pinterest link or pin.it short link into the popup for an instant download.
• Bulk Board & Search Scanner: Open any board or search page, scan all visible media, filter by resolution/type, and batch download.
• Smart Filename Formatting: Customizable templates with {title}, {index}, {date}, and {pin_id} plus subfolder organization.
• Built-in Duplicate Prevention: Detects duplicate pins and images across sessions so you never download the same file twice.
• Media Collections & History: Organize saved media into custom collections and review your recent download history.
• CSV & JSON Export: Export your media inventory with dimensions, titles, formats, and URLs.
• 100% Private & Local-First: Runs completely on your device. Zero analytics, zero trackers, and no external servers.

---------------------------------------------------------
👨‍💻 DEVELOPER & DIRECT SUPPORT
---------------------------------------------------------
Developed by Muhammad Hamid — Web Developer, Digital Marketing Head, Technical SEO, Google Ads & Meta Ads Specialist based in Lahore.

• Portfolio: https://abouthamid.web.app/
• GitHub: https://github.com/hamid-digitalmarketer
• Direct WhatsApp: +92 316 7417135 (https://wa.me/923167417135)
• Contact Email: hamidbloger1@gmail.com

Need help, custom feature requests, or have questions? Feel free to reach out directly via WhatsApp or GitHub issues!

---------------------------------------------------------
🔒 PRIVACY & COMPLIANCE
---------------------------------------------------------
• No account required: PinVault works without registration.
• PinVault only interacts with Pinterest domains to discover media and Chrome's native download API to save files to your computer.
• PinVault respects content boundaries: Private/login-gated pins require your own active login session, and segmented HLS/DRM streams are not touched.
```

---

## 3. Privacy Policy & Permissions Justification

When prompted in the **Privacy** tab of the Developer Console:

### Single Purpose
> "Allows users to save Pinterest images and directly accessible videos to their local storage with resolution selection, batch downloading, and duplicate detection."

### Permissions Justification:
- **`downloads`**: Used exclusively to save requested images and videos to the user's local disk via Chrome's downloads API.
- **`storage`**: Used to save user preferences (filename pattern, folder name, filters), recent download history, and duplicate detection keys locally on the device.
- **`activeTab`**: Used to scan pins on the active Pinterest tab when the user clicks 'Scan current page'.
- **Host Permissions (`*://*.pinterest.com/*`, `*://*.pinimg.com/*`, `https://pin.it/*`)**: Required to detect pin media URLs on Pinterest and resolve short links. No other domains are accessed.

### Data Usage:
- Check: **"Does not sell user data to third parties"**
- Check: **"Does not use or transfer user data for purposes unrelated to the item's core functionality"**
- Check: **"Does not use or transfer user data to determine creditworthiness or for lending purposes"**
- **Privacy Policy URL**: `https://github.com/hamid-digitalmarketer/pinvault-pinterest-downloader/blob/main/docs/privacy-policy.md` (or `https://abouthamid.web.app/`)
