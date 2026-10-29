import UIKit
import WebKit

// Share locally stored ECU backup files from the bundled file:// WKWebView.
// Browser Blob URL downloads do not always work in WKWebView; the backup
// stays inside the app until the user explicitly exports it.
final class BackupExportBridge: NSObject, WKScriptMessageHandler {
    private weak var presenter: UIViewController?

    init(presenter: UIViewController) {
        self.presenter = presenter
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "blinkBackupExport", message.frameInfo.isMainFrame,
              let values = message.body as? [String: Any],
              let fileName = values["filename"] as? String,
              let json = values["text"] as? String else { return }

        let bytes = Data(json.utf8)
        guard !bytes.isEmpty, bytes.count <= 600_000,
              let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              parsed["bundle"] as? String == "BLINK_ECU_APP_FILE_V1"
        else { return }

        // Filenames are untrusted JS input: allow only ASCII letters, digits,
        // dash, underscore and dot, and force .json for Files/AirDrop.
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        let cleaned = String(fileName.unicodeScalars.filter { allowed.contains($0) }.prefix(80))
        guard !cleaned.isEmpty else { return }
        let baseName = cleaned.hasSuffix(".json") ? cleaned : cleaned + ".json"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(baseName)

        do {
            try bytes.write(to: url, options: .atomic)
        } catch {
            print("BLINK backup export file write failed: \(error.localizedDescription)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let owner = self?.presenter, owner.presentedViewController == nil else { return }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = share.popoverPresentationController {
                popover.sourceView = owner.view
                popover.sourceRect = CGRect(x: owner.view.bounds.midX,
                                           y: owner.view.bounds.midY,
                                           width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            owner.present(share, animated: true)
        }
    }
}
