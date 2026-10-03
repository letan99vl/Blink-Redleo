import UIKit
import WebKit

final class MainViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var bleBridge: BLEBridge!
    private var orientationMask: UIInterfaceOrientationMask = .allButUpsideDown

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        UIApplication.shared.isIdleTimerDisabled = true
        edgesForExtendedLayout = .all
        extendedLayoutIncludesOpaqueBars = true
        modalPresentationCapturesStatusBarAppearance = true
        viewRespectsSystemMinimumLayoutMargins = false

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()

        let userContentController = WKUserContentController()
        configuration.userContentController = userContentController

        for scriptName in ["ios_fullscreen_fix", "native_bridge_ios"] {
            if let url = Bundle.main.url(forResource: scriptName, withExtension: "js"),
               let source = try? String(contentsOf: url, encoding: .utf8) {
                userContentController.addUserScript(
                    WKUserScript(
                        source: source,
                        injectionTime: .atDocumentStart,
                        forMainFrameOnly: true
                    )
                )
            }
        }

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        webView.allowsBackForwardNavigationGestures = false
        webView.customUserAgent = "BLINK-REDLEO-IOS/1.0"

        bleBridge = BLEBridge(
            webView: webView,
            presenter: self,
            orientationHandler: { [weak self] value in
                self?.requestOrientation(value)
            }
        )
        userContentController.add(bleBridge, name: "iosBLE")

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        var components = URLComponents(string: "https://letan99vl.github.io/Blink-Redleo/")!
        components.queryItems = [
            URLQueryItem(name: "ios", value: "1"),
            URLQueryItem(name: "v", value: "1")
        ]
        if let url = components.url {
            let request = URLRequest(
                url: url,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: 30
            )
            webView.load(request)
        }
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "iosBLE")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        setNeedsStatusBarAppearanceUpdate()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsStatusBarAppearanceUpdate()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .none }
    override var childForStatusBarHidden: UIViewController? { nil }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientationMask }

    private func requestOrientation(_ value: String) {
        let next: UIInterfaceOrientationMask
        switch value.lowercased() {
        case "portrait": next = .portrait
        case "landscape-left": next = .landscapeLeft
        case "landscape-right": next = .landscapeRight
        case "landscape": next = .landscape
        default: next = .allButUpsideDown
        }

        orientationMask = next

        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
        }

        if #available(iOS 16.0, *), let scene = view.window?.windowScene {
            let prefs = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: next)
            scene.requestGeometryUpdate(prefs) { error in
                print("Orientation request failed: \(error.localizedDescription)")
            }
        } else {
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
