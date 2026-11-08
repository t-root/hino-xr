# HINO XR

Ứng dụng web XR cho điện thoại đặt trong kính: mở camera, vẽ **hai mắt (stereo)** với ảnh camera làm nền, điều khiển bằng **cử chỉ tay** và **giọng nói**, nhận diện vật thể bằng các **plugin** chạy cục bộ, và có một **trợ lý nói chuyện tên HINO** chạy trên máy tính.

Mọi giao diện bán trong suốt, một màu, góc vuông, vẽ chồng lên ảnh camera.

## Chạy nhanh

Cần **Python 3.11 trở lên** (`run.bat` tự chọn bản 3.11). Không dùng Node.js, không `npm`, không `node_modules`.

```bash
python run.py        # https://127.0.0.1:5173
python run.py test   # chạy toàn bộ unittest
```

Trên Windows bấm đúp `run.bat` (chỉ gọi `run.py`). `run.py` cài gói Python còn thiếu, tắt tiến trình cũ đang giữ cổng **5173**, đóng gói giao diện, rồi mở **một** tiến trình HTTPS trên 5173: trang web, camera và `/api` của trợ lý nằm chung một chỗ.

- **Điện thoại:** cùng Wi-Fi, mở `https://<địa-chỉ-máy>:5173` (có chữ **s**; không có HTTPS thì trình duyệt chặn camera). Lần đầu trình duyệt cảnh báo giấy chứng nhận tự ký: chọn tiếp tục rồi tải lại.
- **Lần chạy đầu cần mạng** để tải thư viện (Three.js, MediaPipe, esbuild dạng file thực thi), mô hình thị giác và mô hình trợ lý. Mọi thứ cần tải khai báo trong `downloads.json` và `vendor.json`; file có sẵn thì bỏ qua, bị ngắt thì tải tiếp, sai sha256 thì tải lại. Lần sau chạy offline.
- Mô hình trợ lý nặng vài GB, nằm trong `assistant/weights/` (không đưa vào git). Riêng giọng mẫu `assistant/voices/hino.wav` (vài giây) nằm trong git; muốn đổi giọng thì thay file này bằng một đoạn ghi âm khác, một người nói, khoảng 5 đến 8 giây, sạch tiếng ồn.

## Cách dùng

1. **Bấm dấu vân tay.** Camera mở, trang vào toàn màn hình, màn hình chia hai mắt. Lúc này chưa có menu, chưa có tay, chưa có trợ lý; micro chờ đúng cụm **"system call"**.
2. **Nói "system call"** (hoặc bấm phím `S`, xem bên dưới). Hệ thống khởi động: nhật ký khởi động chạy, theo dõi tay bật, trợ lý nạp mô hình và chào.
3. **Gọi trợ lý bằng tên "hino"**, hỏi luôn trong câu ("hino, mấy giờ rồi") hoặc gọi xong rồi hỏi. Sau mỗi câu trả lời trợ lý nghe thêm một lúc (mặc định 10 giây, chỉnh trong menu trợ lý) rồi ngủ lại.
4. **Búng tay để mở menu**, chụm ngón để bấm và kéo.

### Phím gỡ lỗi (máy tính)

| Phím | Tác dụng |
|---|---|
| `S` | Giả lập câu "system call": khởi động hệ thống không cần nói. Chỉ có tác dụng khi đang chờ "system call". |
| `M` | Giả lập cú búng tay: mở hoặc đóng menu. Bị bỏ qua lúc đang chờ hoặc đang khởi động. |

Các phím khác không làm gì. Phím cũng không chạy khi đang gõ trong ô nhập hoặc giữ Ctrl/Alt/Meta.

### Xoay đầu để lướt menu (cảm biến điện thoại)

Khi thanh danh mục của menu đang hiện, **xoay đầu sang phải** thì thanh trượt tới mục kế, **sang trái** thì về mục trước. Thanh bám theo chuyển động và chốt vào mục gần nhất sau khoảng 16°, giống như vuốt tay. Hướng được đọc từ mặt sau của điện thoại trên mặt phẳng ngang, nên không phụ thuộc điện thoại đang dọc hay ngang. Tay đang kéo thanh thì cảm biến nhường tay. Nhìn gần thẳng lên hoặc xuống thì không phản hồi. Mã ở `src/app/ImuMenu.ts`.

## Điều khiển bằng tay

Chỉ có **một** cử chỉ chạm: **chụm ngón cái và ngón trỏ**. Con trỏ nằm ở điểm giữa hai đầu ngón nên đứng yên khi chụm.

- **Buông tại chỗ là bấm.** Đưa con trỏ lên nút, chụm, nhả.
- **Giữ hoặc đi xa là kéo.** Chụm rồi đi quá 5% khung nhìn, hoặc giữ quá nửa giây, thì thành kéo (thanh trượt, thanh danh mục, vùng cuộn). Buông tại chỗ vẫn là bấm.
- **Mất dấu tay là hủy**, không phải bấm.
- **Hai tay cùng chụm rồi giang ra hoặc khép vào là phóng to hoặc thu nhỏ** thứ nằm giữa hai tay (bản đồ, cảnh 3D). Cử chỉ này nhận ra một lần trong Core (`TwoHandGesture`), gửi đi như con lăn chuột nên mọi thứ dùng được con lăn đều dùng được; sự kiện `twohand` trên bus còn có `rotation` và `pan` cho nơi nào cần xoay hay kéo. Khi bắt đầu, cú chụm riêng của từng tay bị bỏ.
- **Bàn phím ảo tự nổi lên** khi bạn chụm (hoặc chạm, bấm chuột) vào một ô chữ ở bất cứ đâu, trong menu hay trong plugin. Bàn phím của điện thoại không hiện. Bố cục như bàn phím điện thoại: hàng số ở trên, chữ ở dưới. Phím chức năng là biểu tượng (mũi tên lên là **Hoa**: bấm một lần cho một chữ, bấm lần nữa để khóa; ô vuông có dấu x là **Xóa**; khung hở dưới là **Cách**; mũi tên gập là **Xuống dòng**; mũi tên trái phải dời con trỏ; dấu tick là **Xong**; micro là **Đọc chữ**), **?123** chuyển sang ký tự (bấm **=\<** để sang trang ký tự còn lại, **ABC** để về chữ), **Xóa**, **Cách**, dấu phẩy và chấm cạnh phím cách, **Xuống dòng**, **Trái / Phải** dời con trỏ, **Xong** để cất. Phím **VI / EN** đổi cách gõ: VI là Telex (`aa` ra â, `dd` ra đ, `w` ra ư ơ ă, `s f r x j` đặt dấu), EN gõ nguyên chữ. Phím **Đọc chữ** bấm một lần để nói, bấm lần nữa để chữ được điền vào ô.
- **Búng tay** (ngón cái ép vào ngón giữa rồi ngón giữa bật xuống lòng bàn tay) **bật hoặc tắt menu.** Cử chỉ được nhận theo ba pha ép, trượt, rơi nên không nhầm với nhả chụm. Có thể tắt trong mục cử chỉ.

Tay bấm giao diện qua **một đường duy nhất** trong Core: `DomPointerSurface` tìm phần tử dưới con trỏ, `dispatchHandPointer` phát đúng các sự kiện con trỏ như chuột (`pointerdown`, `pointermove`, `pointerup`). Nên cái gì chuột làm được thì tay làm được; phần tử không phải nút cần thêm `data-hand-target`.

**Con trỏ** là khung ngắm vuông: bốn góc chữ L, một ô nhỏ ở giữa đầy dần khi giữ, một khung ngoài đứng yên khi kéo, và một khung loé ra khi bấm trúng. Nó là một lớp DOM riêng trong mỗi mắt, nằm **trên mọi thứ** (menu, bàn phím ảo, màn hình plugin) và không nhận cú bấm. Độ rõ và cỡ chỉnh trong mục **con trỏ**.

Mục **chẩn đoán** hiện một dòng chỉ số ở góc mỗi mắt: `FPS`, `FPS CAM`, `FPS HAND` và `MIC <chế độ> <mức âm>`. `MIC name check` là Hino đang ngủ và chỉ nghe tên "Hino"; `MIC model listening` là Hino đã được gọi và đang chờ câu hỏi; `MIC working` là đang trả lời. Dòng này giới hạn ở 60% bề rộng mắt nên chỉ có bấy nhiêu mục.

## Menu

Menu nằm giữa khung camera của mỗi mắt. Phần đầu là **thanh danh mục** cuộn vòng, không có mục đầu hay cuối: mỗi mục là một cái tên đặt trên một đoạn vạch nghiêng, mục đang chọn có vạch dài và sáng, hai đầu mờ dần, nằm trong một khung trong suốt màu chính. Vuốt hoặc xoay đầu để tới mục, chạm mục ở giữa để vào chi tiết.

13 mục:

| Mục | Dùng để |
|---|---|
| hai mắt | Chuyển giữa hai mắt và một khung |
| xoay | Xoay giao diện 90° (ảnh camera đứng yên); có chế độ tự xoay theo hướng cầm máy |
| thấu kính | Khoảng cách hai mắt, khe giữa, trường nhìn, cỡ khung camera, lệch tâm, độ méo `k1`/`k2`, khoảng cách giao diện, nút đặt lại |
| cử chỉ | Độ nhạy chụm ngón, ngưỡng và thời gian giữ để thành kéo, bật tắt búng tay |
| con trỏ | Độ rõ và cỡ con trỏ |
| màu | Màu chính và màu phụ (sắc, độ đậm, độ sáng, độ trong), nút đặt lại màu |
| tiện ích | Bật tắt plugin |
| trợ lý | Bật tắt trợ lý, chọn mô hình, Tải, Nói / Dừng, thử một câu chữ, giọng đọc (cao độ, tốc độ, biểu cảm, nhịp, quãng nghỉ: lần lượt là cao độ giọng, tốc độ, `temperature`, `top_p`, `silence_p` của VieNeu; mặc định 138 Hz là cao độ thật của giọng mẫu), thời gian nghe |
| luồng xử lý | FPS theo dõi tay, FPS của plugin, cỡ ảnh phân tích |
| camera | Lật ảnh camera trước |
| chẩn đoán | Khung chỉ số ở góc mỗi mắt |
| nhật ký | Mọi dòng console của phiên này (đệm 300 dòng, dòng mới ở trên, có nút xoá) |
| ngôn ngữ | Tiếng Việt hoặc English, đổi ngay cả giao diện lẫn tên plugin |

Phần lớn cài đặt cũng **chỉnh được bằng giọng nói** (xem phần trợ lý).

## Trợ lý HINO

Trợ lý là tiến trình Python trong `assistant/`, chạy trên máy tính và chung cổng 5173 với trang. Điện thoại chỉ gửi chữ hoặc một đoạn WAV và nhận chữ cùng tiếng nói về.

| Việc | Cách làm |
|---|---|
| Trả lời | Qwen 2.5 3B (GGUF, llama.cpp, CPU mặc định). Câu trả lời được đọc từng câu ngay khi viết xong câu đó. |
| Nghe | Whisper chép chữ. `ggml-small` nghe từ gọi cho nhanh, `ggml-large-v3` nghe câu hỏi và lệnh. |
| Nói tiếng Việt | VieNeu-TTS v3 Turbo (ONNX, CPU), clone từ giọng mẫu `assistant/voices/hino.wav`. Tải về `assistant/weights/vieneu/` qua `downloads.json`, chạy cục bộ, không cần mạng. |
| Nói tiếng Anh | SAPI của Windows. |
| Từ gọi | "system call" (khởi động, `src/shared/wake.json`) và "hino" (đánh thức trợ lý, `src/shared/assistant.json`). So khớp gần đúng theo âm, bỏ dấu. |

Trợ lý đang nói thì micro tạm tắt để không nghe lại chính nó. Trình duyệt chỉ cắt các đoạn có tiếng theo độ to và gửi lên `/api/voice/listen`; việc nhận cụm gọi làm ở Python (`assistant/models/wake.py`).

### Điều khiển bằng giọng nói

Hai nhóm lệnh được xử lý trước khi hỏi mô hình (`assistant/models/commands.py`, `controls.py`):

- **Plugin:** "bật plugin bản đồ", "tắt plugin nhận diện khuôn mặt"; tiếng Anh cũng được.
- **Menu:** "tăng tốc độ đọc", "giảm độ rõ con trỏ", "tắt chẩn đoán", "chuyển sang tiếng Anh", "mở mục giọng đọc". Hỗ trợ số (tăng/giảm, đặt giá trị, tối đa/tối thiểu/mặc định/phần trăm), công tắc (bật/tắt), lựa chọn và mở một mục menu. Danh sách thứ chỉnh được nằm trong `src/shared/voice-controls.json`.

### Trợ lý viết plugin

Nói "tạo plugin đếm số người" rồi mô tả: trợ lý viết một bản nháp vào `plugins-pending/` (kiểm tra mã, biên dịch, **chưa cài**). Bạn nói "duyệt plugin …" để cài hoặc "từ chối plugin …" để bỏ. Bản nháp chỉ được chạy như plugin đọc khung hình camera; quyền `network`, `screen`, `snapshot` không bao giờ cấp tự động. Các bước kiểm tra là lưới đỡ lỗi chứ không phải hộp cát, nên bạn nên đọc thư mục nháp trước khi duyệt.

Nguồn viết mã: `VR_CODE_SOURCE=local` (mặc định, ngoại tuyến, chỉ lệnh theo từ khoá) hoặc `api` (cần `VR_ANTHROPIC_KEY`; mô hình thêm hiểu những yêu cầu từ khoá không bắt được và làm menu bằng gọi công cụ). Nói "dùng API" hoặc "dùng local" để đổi khi đang chạy.

### Cấu hình trợ lý

Biến môi trường (đặt trong `assistant/.env`, mẫu ở `assistant/.env.example`): `VR_MODEL_PATH`, `VR_WHISPER_PATH`, `VR_WHISPER_WAKE_PATH`, `VR_VOICE_VI_PATH` (thư mục giọng đọc, có `turbo/` và `codec/`), `VR_N_THREADS`, `VR_N_GPU_LAYERS` (`0` = CPU, `-1` = hết lớp lên GPU), `VR_N_CTX`, `VR_CHAT_FORMAT`, `VR_CODE_SOURCE`, `VR_ANTHROPIC_KEY`, `VR_CODE_MODEL`, `VR_AGENT_MODEL`. Tên gọi sửa ở `src/shared/assistant.json`; khoảng giá trị và mặc định của giọng đọc ở `src/shared/voice.json`.

API của trợ lý: `/api/health`, `/api/models`, `/api/models/{id}` (+ `load`, `complete`, `wake`, `talk`), `/api/plugins/pending`, `/api/plugins/draft`, `/api/plugins/{id}/approve|reject`, `/api/voice/preview`, `/api/voice/listen`, `/api/voice/dictate` (giọng thành chữ cho phím Đọc chữ), `/api/people` (người đã lưu, xem mục Nhận diện khuôn mặt).

## Plugin có sẵn

Mỗi plugin là một thư mục trong `src/modules/`, chỉ tải khi bật.

| Plugin | Làm gì |
|---|---|
| **Phát hiện người** (`person-detection`) | Khoanh người trong khung hình. |
| **Nhận diện khuôn mặt** (`face-recognition`) | Khoanh mặt trong tầm khoảng 2 mét và cho biết đó là ai. Người đã lưu thì **tên, năm sinh và thông tin hiện ngay cạnh mặt**; người chưa lưu ghi "Chưa biết". Xem mục bên dưới. |
| **Quét đồ vật** (`object-detection`) | Gọi tên khoảng 80 loại đồ vật thường gặp (EfficientDet-Lite0 int8, 4,4 MB). |
| **Mô tả cảnh** (`scene-description`) | Nói cho bạn nghe trước mặt có gì. Không vẽ khung. Xem mục **Nhìn bằng giọng nói**. |
| **Đọc mã** (`code-reader`) | Đọc mã QR và mã vạch, ghi nội dung lên hình. Xem mục **Nhìn bằng giọng nói**. |
| **Bản đồ 3D** (`map3d`) | Màn hình riêng, xem bên dưới. |

### Nhận diện khuôn mặt

Mỗi khuôn mặt được biến thành **128 con số** (SFace, chạy ngay trong trình duyệt bằng onnxruntime-web; BlazeFace tìm mặt và mắt mũi miệng để căn thẳng mặt trước). Hai ảnh của một người cho các số gần nhau (độ giống cosine từ 0,4 trở lên thì coi là cùng người), hai người khác nhau thì xa nhau. **Ảnh mặt không được lưu**, chỉ lưu các con số, cùng tên, năm sinh và một ô thông tin, trong `assistant/data/people.json` trên máy chạy Hino (không đưa vào git), nên đóng trang cũng không mất.

- **Màn hình của plugin:** một thẻ nhỏ phía dưới khung camera. Người đã lưu thì tên, năm sinh và thông tin hiện ngay cạnh mặt, thẻ có **Thêm mẫu** (ghi thêm một lần nhìn để nhận ra chắc hơn) và **Danh sách**. Với người lạ có nút **Lưu người này**: điền **Tên**, **Năm sinh**, **Thông tin** (bàn phím ảo tự hiện) rồi **Lưu**. **Danh sách** xem, sửa và xóa mọi người.
- **Bằng giọng nói:** "Hino, lưu người này, tên là Nam, sinh năm 1990, thông tin: bạn đại học". Có thể nói từng phần ("người này sinh năm 1990", rồi "thông tin người này là hàng xóm"); người lạ cần có tên mới được lưu, phần đã nói được giữ 90 giây chờ phần còn lại. Người đã lưu thì lệnh sửa chính người đó. Tiếng Anh cũng được ("save this person, name John, born 1980, info neighbour").
- **API:** `GET/POST /api/people`, `PATCH/DELETE /api/people/{id}`, `POST /api/people/{id}/samples`.

Các plugin nhận diện chạy trong worker, trả về hộp và nhãn cho Core; **Core vẽ khung kèm nhãn lên camera** (trên mặt phẳng video nên hai mắt luôn khớp).

### Nhìn bằng giọng nói

Hai plugin trả lời bằng lời, qua cùng đường với lệnh lưu người (`VisionModule.command`):

- **Mô tả cảnh:** "Hino, tôi đang thấy gì?", "xung quanh có gì?", "mô tả cảnh trước mặt" (tiếng Anh: "what do I see?", "describe the scene"). Plugin tự chạy bộ nhận đồ vật riêng (EfficientDet-Lite0, có cả người), gom kết quả trong khoảng 2,5 giây gần nhất rồi nói, ví dụ "Tôi thấy hai người, một cốc và một laptop."
- **Đọc mã:** "Hino, đọc mã", "quét mã QR" ("read the QR code"). Mã QR và mã vạch (EAN, UPC, Code 128, Data Matrix…) được khoanh kèm nội dung ngay trên hình; câu nói đọc lên mã đang nhìn thấy. Bộ giải mã là zxing-wasm, khai trong `models.json` của plugin.

Plugin đang tắt thì Hino nói "Hãy bật tiện ích … trước".

### Bản đồ 3D

Hai bước:

1. **Chọn vùng trên bản đồ.** Bản đồ Leaflet (ô bản đồ từ máy chủ OpenStreetMap Đức). Kéo một tay (hoặc chuột, hoặc ngón) để di chuyển. **Chọn vùng:** chụm hai tay (mỗi tay ngón cái và ngón trỏ, tức bốn ngón) rồi kéo hai tay ra xa nhau; vùng là hình chữ nhật có hai góc là chỗ hai tay chụm, mở tay là xong. **Thu phóng** cũng bằng hai tay: chụm hai tay **cách xa nhau** từ đầu (trên khoảng 16% khung hình) rồi giang ra là phóng to, khép vào là thu nhỏ, quanh điểm nằm giữa hai tay. Chụm sát thì vẽ vùng, chụm xa thì thu phóng: chỗ hai tay chụm lúc đầu quyết định. Dùng chuột thì giữ **Shift** và kéo để vẽ vùng, con lăn để thu phóng. Chọn lại bằng cách vẽ lại: vùng mới thay vùng cũ. **Mỗi lần mở plugin bản đồ tự nhảy tới vị trí của thiết bị** (cần cho phép định vị); biểu tượng ngắm tròn trong hàng nút phía trên là nút bay về lại vị trí đó khi bạn đã kéo bản đồ đi chỗ khác, nút chuyển đỏ nếu không định vị được. Hàng nút phía trên (Đóng, Quay lại, Bước tiếp, định vị) nằm gọn ở giữa, không che bản đồ. Bước này nằm trong khung camera vuông.
2. **Thành phố 3D.** Bấm Bước tiếp: tải toà nhà và đường phố của vùng (API OpenStreetMap; nếu mạng chặn thì ô vector OpenFreeMap, cuối cùng là Overpass), dựng thành cảnh 3D lấp đầy cả mắt, tự đặt camera vào tâm cụm nhà. Đường phố được tải cho cả vòng tròn bao quanh vùng chọn.

Trong cảnh 3D, tay làm việc với cái nó nắm vào.

| Nắm vào | Một tay chụm rồi kéo | Hai tay cùng chụm |
|---|---|---|
| **Cảnh** (chỗ không có nhà) | Trượt cả khu vực | Giang ra hoặc khép vào là thu phóng, vặn tay là xoay quanh tâm, nâng hoặc hạ cả hai tay là nghiêng góc nhìn |
| **Nhà** | Nhà đó được chọn, kéo lên xuống đổi chiều cao, trái phải đổi bề rộng | Dời ngôi nhà nằm giữa hai tay trên mặt đất |

Chụm vào một tòa nhà để chọn; tòa được chọn **sáng lên như khi rê chuột**. Với chuột và cảm ứng: kéo để xoay, lăn để phóng, kéo tòa đã chọn để dời, hai ngón để đổi cỡ.

Nếu bản đồ trống hoặc không tải được toà nhà: một số mạng chặn các dịch vụ của OpenStreetMap (DNS trả `tile.openstreetmap.org` về `127.0.0.1`). Ô bản đồ lấy từ `openstreetmap.de` và toà nhà có đường dự phòng OpenFreeMap, nhưng đổi DNS máy hoặc router sang `1.1.1.1` / `8.8.8.8`, hoặc đổi mạng, vẫn là cách chắc nhất.

Plugin cần mạng (`network`): gửi vùng bạn chọn tới OpenStreetMap, tải ô bản đồ từ openstreetmap.de và phông Pretendard từ jsDelivr. Không có khung camera nào rời máy.

## Giao diện

Ràng buộc bắt buộc, có test kiểm tra:

- Mọi lớp giao diện **bán trong suốt**; camera luôn nhìn thấy.
- **Một màu chính** (và một màu nhấn). Đổi bằng mục màu hoặc `src/ui/theme.ts`; DOM và cảnh 3D dùng chung nên không lệch.
- **Mọi thứ vuông góc**, không bo, không hình tròn.
- **Không icon, emoji hay ảnh**; thanh cuộn và công tắc dựng lại bằng khối vuông.
- Chuyển động tắt được khi người dùng chọn giảm chuyển động.

**Nhật ký khởi động** là các dòng console chạy lướt trên ảnh camera (tên dịch vụ kiểu Linux, chữ tiếng Anh giữ nguyên) cùng các mốc thật (camera, tay, trợ lý, giọng, sẵn sàng) in thành dòng riêng.

**Song ngữ Việt/Anh.** Toàn bộ câu chữ nằm trong `src/i18n/text.json` (plugin có `text.json` riêng trong thư mục của nó); mã nguồn chỉ gọi bằng khoá. Test giữ cho không file `.ts` nào chứa chữ tiếng Việt và mỗi câu có đủ hai ngôn ngữ.

**Hai mắt luôn giống nhau.** Giao diện vẽ một bản cho mỗi mắt, cả hai đọc cùng một nguồn trạng thái (`SharedUiStore`, `core/sync`); hình học mắt chỉ có một nguồn (`StereoLayout`). Nội dung có đồng hồ riêng như canvas hay video chỉ giải mã hoặc vẽ **một lần** rồi chép sang từng mắt. Trang web bên thứ ba nhúng thì tự về một khung (không thể đồng bộ hai iframe). Quy tắc đầy đủ ở `rules.md`.

**Màn hình đầy mắt.** Giao diện mặc định nằm trong hình vuông camera của mỗi mắt (`.camera-frame`). Cảnh 3D của bản đồ bật cờ `fillFrame` để khung rộng bằng cả mắt và màn hình plugin dùng 100% khung; vị trí tay khi đó tính theo đúng chỗ con trỏ được vẽ.

## Kiến trúc

```
camera → FrameHub ─┬→ HandTracking → làm mượt → GestureStateMachine → InteractionManager → menu / plugin
                   └→ ModuleManager → plugin (worker, MediaPipe) → DetectionBatch → OverlayRenderer
                                         StereoRenderer vẽ scene hai lần (mắt trái, mắt phải)

micro / giao diện ──HTTPS /api──► Python :5173 (trang + Qwen + Whisper + VieNeu)
```

| Đường dẫn | Nội dung |
|---|---|
| `src/app` | Khởi tạo ứng dụng, phím gỡ lỗi (`debugKeys.ts`), cảm biến lướt menu (`ImuMenu.ts`) |
| `src/core/camera` | `CameraController` (chủ duy nhất của `getUserMedia`), `FrameHub`, `FrameScheduler` |
| `src/core/rendering` | `StereoLayout`, `StereoRenderer`, `CursorLayer`, `OverlayRenderer`, `LensDistortionPass`, `CoordinateMapper` (nơi duy nhất tính toạ độ) |
| `src/core/input` | Theo dõi tay, lọc, nhận cử chỉ (chụm, búng tay, hai tay), state machine, `DomPointerSurface` |
| `src/core/models` | Cầu HTTP tới trợ lý (`ModelClient`, `ModelBridge`), `WakeController`, `VoiceControls` |
| `src/core/audio` | Thu micro, phát giọng nói, nghe từ gọi |
| `src/core/modules` | Hợp đồng plugin, `ModuleManager`, quyền, `ModuleScreenHost` (màn hình riêng của plugin) |
| `src/core/sync` | `SharedState`, `CopySync`, `CanvasMirror`, `frameClock`: mọi cơ chế giữ hai mắt giống nhau |
| `src/core/media` | Video và nội dung nhúng |
| `src/core/view` | Toàn màn hình, xoay giao diện, tự xoay theo hướng cầm máy |
| `src/ui` | Màu (`theme.ts`), stylesheet, thanh danh mục, panel menu, nhật ký khởi động |
| `src/modules/*` | Một thư mục một plugin |
| `src/shared` | Hợp đồng dùng chung, `assistant.json`, `wake.json`, `voice.json`, `voice-controls.json` |
| `src/i18n` | `text.json` và lớp gắn kiểu |
| `assistant/` | Tiến trình Python: trang + `/api`, llama.cpp, Whisper, VieNeu, lệnh giọng nói, viết plugin |
| `run.py`, `run.bat` | Khởi động; `downloads.json`, `vendor.json` ghim những gì cần tải |
| `public/` | Mô hình thị giác, WASM, JS đã đóng gói; sinh ra nên không nằm trong git |
| `rules.md` | Quy tắc bắt buộc cho Core và plugin |

Quyết định đáng nhớ: một `CoordinateMapper` duy nhất; overlay là con của mặt phẳng video nên hai mắt tự có thị sai đúng; hàng đợi mỗi bên nhận độ sâu 1 (khung mới thay khung cũ); kết quả plugin đi qua Zod và phải khớp `sourceFrameId`; plugin không khai báo màu (hiển thị thuộc về Core); không gọi CDN công cộng lúc chạy (nhân WASM chép từ `vendor/` để không lệch phiên bản với JS, mô hình ghim SHA-256).

## Viết một plugin mới

Một plugin là **một thư mục** `src/modules/<id>/` có `plugin.ts`; không sửa file nào khác. Core quét `src/modules/*/plugin.ts`.

```ts
import { definePlugin } from "@/core/modules/definePlugin";
import { myManifest } from "./manifest";

export default definePlugin({
  manifest: myManifest,
  load: async () => (await import("./MyModule")).createMyModule(),
});
```

- Chữ của plugin ở `text.json` trong thư mục, đủ cả hai ngôn ngữ.
- Plugin dùng mô hình trong worker thì dùng `createDetectorModule` của Core; mô hình khai trong `models.json` dưới `files[]` (`file`, `url`, `sha256`), tải vào `src/modules/<id>/models/`. Thư viện riêng ghim ở `vendor.json` trong thư mục plugin. Một mô hình GGUF cho trợ lý thì khai `slots[]`.
- Module **không** được gọi `getUserMedia`, đụng DOM hay tự vẽ lớp phủ; chỉ trả hộp chuẩn hoá `0..1`.
- Plugin là cả một ứng dụng (như bản đồ) xin quyền `screen` và gọi `context.screen.show(view)`; Core gọi `view` một lần cho mỗi mắt, nên mọi bản phải vẽ từ một trạng thái chung.
- Quyền `network`, `snapshot`, `screen` phải do người ghi tay vào `src/core/modules/permissions.ts`; manifest không tự cấp cho mình được.

## Quyền riêng tư

- Camera chỉ mở sau cú bấm dấu vân tay.
- Khung hình **không rời máy** và không được lưu. Telemetry chỉ là số liệu tổng hợp, đi qua `redactRecord`.
- Mô hình thị giác chạy trong trình duyệt từ `public/`; trợ lý chạy trên máy tính của bạn.
- Ngoại lệ có ghi quyền: `map3d` gọi OpenStreetMap, openstreetmap.de (ô bản đồ), Overpass và jsDelivr (xem trên). Nguồn viết mã `api` gửi mô tả plugin tới API của Anthropic nếu bạn bật.
- Mã trợ lý viết ra chỉ chạy sau khi bạn duyệt.

## Kiểm thử

```bash
python run.py test
```

Chạy các test trong `test/` (camera, khung vuông, giao diện một màu và vuông góc, song ngữ, hai mắt, thấu kính, plugin, lệnh giọng nói, trợ lý viết plugin, tải về, bàn phím ảo, cử chỉ hai tay, lưu người bằng giọng nói, nhận diện mặt, không dùng Node...). Test chạy bằng Python, không cần Node.

## Hướng phát triển

Nhận biển số và OCR, giao diện hiệu chỉnh kính chi tiết hơn, kiểm thử hình ảnh tự động, WebXR immersive (`XRHand`), plugin nhận diện chạy trên máy chủ.
