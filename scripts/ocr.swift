// Read the text in an image with Apple's Vision framework, on this Mac (no network, no AI service).
// Usage: ocr <image path>   -> one recognised line per output line, top to bottom, left to right.
// Built on first use by src/research_room/screenshot.py into data/bin/ocr (gitignored).
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: ocr <image>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false        // player names are not dictionary words
let handler = VNImageRequestHandler(url: url, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("could not read the image: \(error)\n".data(using: .utf8)!)
    exit(1)
}
let lines = (request.results ?? []).compactMap { obs -> (CGFloat, CGFloat, String)? in
    guard let text = obs.topCandidates(1).first?.string else { return nil }
    return (obs.boundingBox.midY, obs.boundingBox.minX, text)
}
// Vision's origin is bottom-left: higher y is nearer the top. Rows within 1% of height go together.
let sorted = lines.sorted { a, b in abs(a.0 - b.0) > 0.01 ? a.0 > b.0 : a.1 < b.1 }
for line in sorted { print(line.2) }
