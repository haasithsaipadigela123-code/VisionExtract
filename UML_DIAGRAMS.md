# Vision Extract — UML Diagrams Specification

This document presents the **three core Unified Modeling Language (UML 2.5)** diagrams for Vision Extract, provided as standalone diagrams with their visual architecture diagrams and Mermaid source code.

---

## 1. UML Use Case Diagram

The **Use Case Diagram** captures the system boundary, external actors, and the core functional requirements of the system.

### Visual Diagram
![UML Use Case Diagram](static/img/uml_use_case.jpg)

### Specification Details
- **Primary Actor**: `User / Forensic Analyst`
- **System Boundary**: `Vision Extract System`
- **Key Relationships**:
  - `Upload Media` **<<include>>** `Perform In-Browser WASM OCR`
  - `Configure Frame Rate (FPS)` **<<extend>>** `Upload Media`
  - `Perform In-Browser WASM OCR` **<<include>>** `Extract Forensic Entities`
  - `Extract Forensic Entities` **<<include>>** `Normalize Dates (DD/MM/YYYY)`
  - `Extract Forensic Entities` **<<include>>** `Fuzzy Deduplication (Email & UPI)`

### Mermaid Code
```mermaid
flowchart LR
    User((👤 User / Forensic Analyst))

    subgraph SystemBoundary["Vision Extract System"]
        UC1(["Upload Media<br/>(Video / Image)"])
        UC2(["Configure Frame<br/>Rate (FPS)"])
        UC3(["Perform In-Browser<br/>WASM OCR"])
        UC4(["Extract Forensic<br/>Entities (Regex)"])
        UC5(["Normalize Dates<br/>(DD/MM/YYYY)"])
        UC6(["Fuzzy Deduplication<br/>(Email & UPI)"])
        UC7(["Filter & Search<br/>Ledger"])
        UC8(["Export Data<br/>(CSV / JSON)"])
    end

    User --> UC1
    User --> UC2
    User --> UC7
    User --> UC8

    UC1 -.->|<<include>>| UC3
    UC2 -.->|<<extend>>| UC1
    UC3 -.->|<<include>>| UC4
    UC4 -.->|<<include>>| UC5
    UC4 -.->|<<include>>| UC6
```

---

## 2. UML Class Diagram

The **Class Diagram** defines the object-oriented structure of the application across the browser frontend (JavaScript) and backend engine (Python Flask).

### Visual Diagram
![UML Class Diagram](static/img/uml_class_diagram.jpg)

### Class Breakdown
1. **`VisionExtractUI`** (Client Controller): Coordinates user input, DOM elements, progress bar, and ledger rendering.
2. **`CanvasFrameSampler`** (Client): Samples video frames onto an offscreen HTML5 `<canvas>` at the configured FPS.
3. **`TesseractWorkerPool`** (Client OCR): Manages the web worker pool running Tesseract.js WASM.
4. **`FlaskController`** (Backend API): Serves routes `GET /` and `POST /extract`.
5. **`ExtractorEngine`** (Backend): Dispatches text to category pattern matchers and normalizers.
6. **`DateNormalizer`** (Backend): Validates calendar bounds and normalizes to `DD/MM/YYYY`.
7. **`FuzzyClusterer`** (Backend): Clusters and merges OCR corrupted email and UPI variations using `difflib.SequenceMatcher`.
8. **`LedgerItem`** (Data Entity): Represents an extracted data row with category, normalized value, and confidence rating.

### Mermaid Code
```mermaid
classDiagram
    class VisionExtractUI {
        -File fileInput
        -Worker[] workers
        +init() void
        +setPhase(status: String) void
        +renderLedger(data: Object) void
        +exportData(format: String) void
    }

    class CanvasFrameSampler {
        -HTMLCanvasElement canvas
        -Number fps
        +extractFrames(file: File, fps: Number) Promise
        +seekFrame(timestamp: Number) Promise
    }

    class TesseractWorkerPool {
        -Array workers
        -Int poolSize
        +ensureEngine() Promise
        +ocrFrames(frames: Array) Promise
        +releaseEngine() Promise
    }

    class FlaskController {
        +index() HTMLTemplate
        +extract() JSONResponse
    }

    class ExtractorEngine {
        +Dict PATTERNS
        +List _RULES
        +extract_from_text(text: String) List
        +_clean_ocr(text: String) String
        +build_results(frames: List) Dict
    }

    class DateNormalizer {
        +Dict MONTH_MAP
        +_norm_date(raw: String) String
        +_valid_date(v: String) Boolean
    }

    class FuzzyClusterer {
        +_is_similar_email(e1: String, e2: String) Boolean
        +_score_quality(email: String, conf: Float) Float
        +dedupe(items: List) List
    }

    class LedgerItem {
        +Int id
        +String category
        +String normalized
        +Float confidence
    }

    VisionExtractUI --> CanvasFrameSampler : uses
    CanvasFrameSampler --> TesseractWorkerPool : invokes
    VisionExtractUI ..> FlaskController : POST /extract
    FlaskController --> ExtractorEngine : calls
    ExtractorEngine --> DateNormalizer : delegates
    ExtractorEngine --> FuzzyClusterer : delegates
    ExtractorEngine ..> LedgerItem : produces
```

---

## 3. UML Sequence Diagram

The **Sequence Diagram** documents the synchronous and asynchronous chronological interactions between components during media processing.

### Visual Diagram
![UML Sequence Diagram](static/img/uml_sequence_diagram.jpg)

### Interaction Steps
1. **User $\rightarrow$ VisionExtractUI**: Uploads media file and triggers scan.
2. **VisionExtractUI $\rightarrow$ CanvasFrameSampler**: Calls `extractFrames()`.
3. **Loop Block (CanvasSampler $\leftrightarrow$ Tesseract.js Worker)**:
   - Frame rendered to canvas.
   - Worker runs OCR recognition.
   - Per-frame text and confidence returned.
4. **VisionExtractUI $\rightarrow$ FlaskController**: Sends `POST /extract` with JSON payload.
5. **FlaskController $\rightarrow$ ExtractorEngine**: Dispatches `build_results()`.
6. **Internal Engine Self-Calls**:
   - `_clean_ocr()` repairs delimiters and character confusions.
   - Regex rules extract candidate items.
   - `_norm_date()` and `_valid_date()` normalize dates.
   - `dedupe()` performs exact matching and fuzzy clustering.
7. **ExtractorEngine $\rightarrow$ FlaskController**: Returns structured ledger items.
8. **FlaskController $\rightarrow$ VisionExtractUI**: Returns `200 OK` JSON.
9. **VisionExtractUI $\rightarrow$ User**: Renders the interactive Forensic Ledger Table.

### Mermaid Code
```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant UI as VisionExtractUI
    participant Sampler as CanvasSampler
    participant OCR as Tesseract.js Worker
    participant API as FlaskController
    participant Engine as ExtractorEngine

    User->>UI: (1) uploadMedia(file, fps)
    UI->>Sampler: (2) extractFrames()

    rect rgb(240, 245, 255)
        note over Sampler, OCR: Video Frame OCR Loop
        loop For each video frame
            Sampler->>OCR: (3) recognize(canvas)
            OCR-->>Sampler: (3) return {text, conf}
        end
    end

    UI->>API: (4) POST /extract {frames}
    API->>Engine: (5) build_results()

    Engine->>Engine: (6) _clean_ocr()
    Engine->>Engine: (6) regexMatch()
    Engine->>Engine: (6) _norm_date()
    Engine->>Engine: (7) dedupe()

    Engine-->>API: (7) structured ledger data
    API-->>UI: (8) 200 OK JSON
    UI-->>User: (9) display Forensic Ledger Table
```
