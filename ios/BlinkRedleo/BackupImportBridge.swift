import UIKit
import WebKit
import UniformTypeIdentifiers

// Import an existing Blink ECU backup using iOS Files. Works with the
// bundled file:// WKWebView even when HTML <input type=file> is unavailable.
final class BackupImportBridge: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate {
    private weak var presenter: UIViewController?
    private weak var webView: WKWebView?

    init(presenter: UIViewController, webView: WKWebView) {
        self.presenter = presenter
        self.webView = webView
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "blinkBackupImport", message.frameInfo.isMainFrame,
              let params = message.body as? [String: Any],
              params["action"] as? String == "pick-json" else { return }
        DispatchQueue.main.async { [weak self] in
            guard let owner = self?.presenter, owner.presentedViewController == nil else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json, .plainText], asCopy: true)
            picker.delegate = self
            owner.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController,
                        didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }

        guard let data = try? Data(contentsOf: url), !data.isEmpty,
              data.count <= 2_150_000 else {
            print("BLINK backup import denied: empty, inaccessible or oversized JSON")
            return
        }
        // Base64 is ASCII and safe to place in a quoted JavaScript literal.
        // The HTML side decodes UTF-8, validates format and CRC, then commits
        // only to local IndexedDB (never to ECU or ESP32).
        let payload = data.base64EncodedString()
        DispatchQueue.main.async { [weak self] in
            let js = "window.blinkReceiveNativeBackupFile && window.blinkReceiveNativeBackupFile('\\(payload)');"
            self?.webView?.evaluateJavaScript(js, completionHandler: { _, error in
                if let error = error {
                    print("BLINK backup import JS bridge failed: \\(error.localizedDescription)")
                }
            })
        }
    }
}
