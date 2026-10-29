import CoreBluetooth
import UIKit
import WebKit

final class BLEBridge: NSObject, WKScriptMessageHandler, CBCentralManagerDelegate, CBPeripheralDelegate {
    private static let devicePrefix = "BLINK-REDLEO"
    private static let serviceUUID = CBUUID(string: "afaf0001-7c35-4a6d-9f0e-2ea3117f1000")
    private static let liveUUID = CBUUID(string: "afaf0002-7c35-4a6d-9f0e-2ea3117f1000")
    private static let commandUUID = CBUUID(string: "afaf0003-7c35-4a6d-9f0e-2ea3117f1000")
    private static let mapUUID = CBUUID(string: "afaf0004-7c35-4a6d-9f0e-2ea3117f1000")
    private static let statusUUID = CBUUID(string: "afaf0005-7c35-4a6d-9f0e-2ea3117f1000")

    private weak var webView: WKWebView?
    private weak var presenter: UIViewController?
    private let orientationHandler: (String) -> Void

    private var central: CBCentralManager!
    private var currentPeripheral: CBPeripheral?
    private var commandCharacteristic: CBCharacteristic?
    private var candidates: [UUID: Candidate] = [:]
    private var scanWorkItem: DispatchWorkItem?
    private var pendingScan = false
    private var connectionReady = false
    private var notificationPending = Set<CBUUID>()
    private var reliableQueue: [WriteRequest] = []
    private var activeReliableWrite: WriteRequest?
    private var noResponseQueue: [Data] = []

    private struct Candidate { let peripheral: CBPeripheral; var rssi: Int }
    private final class WriteRequest {
        let token: Int
        let chunks: [Data]
        var index = 0
        init(token: Int, chunks: [Data]) { self.token = token; self.chunks = chunks }
    }

    init(webView: WKWebView, presenter: UIViewController, orientationHandler: @escaping (String) -> Void) {
        self.webView = webView
        self.presenter = presenter
        self.orientationHandler = orientationHandler
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "iosBLE",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "requestDevice": startScanOrQueue()
        case "disconnect": disconnect()
        case "write": handleWrite(body)
        case "keepScreenOn": UIApplication.shared.isIdleTimerDisabled = body["enabled"] as? Bool ?? true
        case "setOrientation": orientationHandler(body["value"] as? String ?? "auto")
        default: break
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            if pendingScan { pendingScan = false; startScan() }
        case .unauthorized: emitConnectError("Bluetooth permission was denied for BLINK REDLEO.")
        case .poweredOff: emitConnectError("Bluetooth is turned off on this iPhone.")
        case .unsupported: emitConnectError("Bluetooth Low Energy is not supported on this device.")
        default: break
        }
    }

    private func startScanOrQueue() {
        guard central.state == .poweredOn else {
            pendingScan = true
            if central.state == .unauthorized { emitConnectError("Bluetooth permission was denied for BLINK REDLEO.") }
            else if central.state == .poweredOff { emitConnectError("Please turn on Bluetooth and try again.") }
            return
        }
        startScan()
    }

    private func startScan() {
        scanWorkItem?.cancel()
        candidates.removeAll()
        connectionReady = false
        central.stopScan()
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.central.stopScan()
            self.showDevicePicker()
        }
        scanWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5, execute: item)
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let value = RSSI.intValue
        if var existing = candidates[peripheral.identifier] {
            if value > existing.rssi { existing.rssi = value }
            candidates[peripheral.identifier] = existing
        } else {
            candidates[peripheral.identifier] = Candidate(peripheral: peripheral, rssi: value)
        }
    }

    private func showDevicePicker() {
        guard let presenter else { emitConnectError("Unable to display the Bluetooth device picker."); return }
        let sorted = candidates.values.sorted { lhs, rhs in
            let ln = lhs.peripheral.name ?? "", rn = rhs.peripheral.name ?? ""
            let lp = ln.hasPrefix(Self.devicePrefix), rp = rn.hasPrefix(Self.devicePrefix)
            if lp != rp { return lp && !rp }
            return lhs.rssi > rhs.rssi
        }

        if sorted.isEmpty {
            let alert = UIAlertController(title: "No BLE devices found", message: "Turn on the BLINK-REDLEO ESP32 and scan again.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Scan Again", style: .default) { [weak self] _ in self?.startScanOrQueue() })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.emitConnectError("Bluetooth device selection was cancelled.") })
            presentPicker(alert, from: presenter)
            return
        }

        let alert = UIAlertController(title: "Select Bluetooth Device", message: nil, preferredStyle: .actionSheet)
        for item in sorted.prefix(30) {
            let name = item.peripheral.name?.isEmpty == false ? item.peripheral.name! : "BLE Device"
            let marker = name.hasPrefix(Self.devicePrefix) ? "* " : ""
            alert.addAction(UIAlertAction(title: "\(marker)\(name)   \(item.rssi) dBm", style: .default) { [weak self] _ in self?.connect(item.peripheral) })
        }
        alert.addAction(UIAlertAction(title: "Scan Again", style: .default) { [weak self] _ in self?.startScanOrQueue() })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.emitConnectError("Bluetooth device selection was cancelled.") })
        if let popover = alert.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presentPicker(alert, from: presenter)
    }

    private func presentPicker(_ alert: UIAlertController, from presenter: UIViewController) {
        if let shown = presenter.presentedViewController {
            shown.dismiss(animated: false) { presenter.present(alert, animated: true) }
        } else { presenter.present(alert, animated: true) }
    }

    private func connect(_ peripheral: CBPeripheral) {
        scanWorkItem?.cancel()
        central.stopScan()
        if let old = currentPeripheral, old != peripheral { central.cancelPeripheralConnection(old) }
        resetConnectionState()
        currentPeripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        emitConnectError(error?.localizedDescription ?? "Unable to connect to the selected BLE device.")
        resetConnectionState()
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let wasReady = connectionReady
        let wasCurrent = currentPeripheral?.identifier == peripheral.identifier
        if wasCurrent { resetConnectionState() }
        if wasReady { evaluate("window.__iosBleDisconnected&&window.__iosBleDisconnected()") }
        else if wasCurrent && error != nil { emitConnectError(error?.localizedDescription ?? "BLE disconnected before setup completed.") }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error { failSetup("Service discovery failed: \(error.localizedDescription)"); return }
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            failSetup("BLINK REDLEO BLE service was not found."); return
        }
        peripheral.discoverCharacteristics([Self.liveUUID, Self.commandUUID, Self.mapUUID, Self.statusUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error { failSetup("Characteristic discovery failed: \(error.localizedDescription)"); return }
        guard let characteristics = service.characteristics else { failSetup("BLINK REDLEO BLE characteristics were not found."); return }
        var notifyFound = Set<CBUUID>()
        for characteristic in characteristics {
            switch characteristic.uuid {
            case Self.commandUUID: commandCharacteristic = characteristic
            case Self.liveUUID, Self.mapUUID, Self.statusUUID:
                notifyFound.insert(characteristic.uuid)
                peripheral.setNotifyValue(true, for: characteristic)
            default: break
            }
        }
        guard commandCharacteristic != nil else { failSetup("BLINK REDLEO command characteristic was not found."); return }
        let required: Set<CBUUID> = [Self.liveUUID, Self.mapUUID, Self.statusUUID]
        guard notifyFound == required else { failSetup("One or more BLINK REDLEO notification characteristics are missing."); return }
        notificationPending = required
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if let error { failSetup("Notification setup failed: \(error.localizedDescription)"); return }
        if characteristic.isNotifying { notificationPending.remove(characteristic.uuid) }
        if notificationPending.isEmpty, commandCharacteristic != nil, !connectionReady {
            connectionReady = true
            let name = peripheral.name?.isEmpty == false ? peripheral.name! : Self.devicePrefix
            evaluate("window.__iosBleConnected&&window.__iosBleConnected(\(jsString(name)))")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        evaluate("window.__iosBlePacket&&window.__iosBlePacket('\(characteristic.uuid.uuidString.lowercased())','\(data.base64EncodedString())')")
    }

    private func handleWrite(_ body: [String: Any]) {
        guard let peripheral = currentPeripheral, peripheral.state == .connected, let characteristic = commandCharacteristic else {
            let token = number(body["token"]); if token > 0 { emitWriteDone(token: token, ok: false, status: -100) }; return
        }
        let uuid = (body["uuid"] as? String ?? "").lowercased()
        guard uuid == Self.commandUUID.uuidString.lowercased() else {
            let token = number(body["token"]); if token > 0 { emitWriteDone(token: token, ok: false, status: -102) }; return
        }
        guard let b64 = body["base64"] as? String, let data = Data(base64Encoded: b64) else {
            let token = number(body["token"]); if token > 0 { emitWriteDone(token: token, ok: false, status: -103) }; return
        }
        let withResponse = body["withResponse"] as? Bool ?? false
        let token = number(body["token"])
        if withResponse {
            let maxLength = max(20, peripheral.maximumWriteValueLength(for: .withResponse))
            reliableQueue.append(WriteRequest(token: token, chunks: data.chunked(maxLength)))
            drainReliableQueue(peripheral: peripheral, characteristic: characteristic)
        } else {
            let maxLength = max(20, peripheral.maximumWriteValueLength(for: .withoutResponse))
            noResponseQueue.append(contentsOf: data.chunked(maxLength))
            drainNoResponseQueue(peripheral: peripheral, characteristic: characteristic)
        }
    }

    private func drainReliableQueue(peripheral: CBPeripheral, characteristic: CBCharacteristic) {
        guard activeReliableWrite == nil, !reliableQueue.isEmpty else { return }
        activeReliableWrite = reliableQueue.removeFirst()
        sendNextReliableChunk(peripheral: peripheral, characteristic: characteristic)
    }

    private func sendNextReliableChunk(peripheral: CBPeripheral, characteristic: CBCharacteristic) {
        guard let request = activeReliableWrite else { return }
        guard request.index < request.chunks.count else {
            activeReliableWrite = nil
            if request.token > 0 { emitWriteDone(token: request.token, ok: true, status: 0) }
            drainReliableQueue(peripheral: peripheral, characteristic: characteristic)
            return
        }
        peripheral.writeValue(request.chunks[request.index], for: characteristic, type: .withResponse)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == Self.commandUUID, let request = activeReliableWrite else { return }
        if let error = error as NSError? {
            activeReliableWrite = nil
            if request.token > 0 { emitWriteDone(token: request.token, ok: false, status: error.code) }
            if let commandCharacteristic { drainReliableQueue(peripheral: peripheral, characteristic: commandCharacteristic) }
            return
        }
        request.index += 1
        sendNextReliableChunk(peripheral: peripheral, characteristic: characteristic)
    }

    private func drainNoResponseQueue(peripheral: CBPeripheral, characteristic: CBCharacteristic) {
        while !noResponseQueue.isEmpty && peripheral.canSendWriteWithoutResponse {
            peripheral.writeValue(noResponseQueue.removeFirst(), for: characteristic, type: .withoutResponse)
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard let commandCharacteristic else { return }
        drainNoResponseQueue(peripheral: peripheral, characteristic: commandCharacteristic)
    }

    private func disconnect() {
        scanWorkItem?.cancel()
        central.stopScan()
        guard let peripheral = currentPeripheral else { resetConnectionState(); return }
        central.cancelPeripheralConnection(peripheral)
    }

    private func failSetup(_ message: String) {
        emitConnectError(message)
        if let peripheral = currentPeripheral { central.cancelPeripheralConnection(peripheral) }
        resetConnectionState()
    }

    private func resetConnectionState() {
        connectionReady = false
        notificationPending.removeAll()
        commandCharacteristic = nil
        reliableQueue.removeAll()
        activeReliableWrite = nil
        noResponseQueue.removeAll()
        currentPeripheral = nil
    }

    private func emitConnectError(_ message: String) { evaluate("window.__iosBleConnectError&&window.__iosBleConnectError(\(jsString(message)))") }
    private func emitWriteDone(token: Int, ok: Bool, status: Int) { evaluate("window.__iosBleWriteDone&&window.__iosBleWriteDone(\(token),\(ok ? "true" : "false"),\(status))") }
    private func evaluate(_ javascript: String) { DispatchQueue.main.async { [weak webView] in webView?.evaluateJavaScript(javascript, completionHandler: nil) } }

    private func jsString(_ value: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
           let json = String(data: data, encoding: .utf8), json.count >= 2 {
            return String(json.dropFirst().dropLast())
        }
        return "\"\""
    }

    private func number(_ value: Any?) -> Int {
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? Int { return value }
        return 0
    }
}

private extension Data {
    func chunked(_ size: Int) -> [Data] {
        guard !isEmpty else { return [Data()] }
        var result: [Data] = [], offset = 0
        while offset < count {
            let end = Swift.min(offset + size, count)
            result.append(subdata(in: offset..<end))
            offset = end
        }
        return result
    }
}
