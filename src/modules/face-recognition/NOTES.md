# face-recognition: nhận diện khuôn mặt

Ghi chú thiết kế của riêng plugin này (trước đây ở `rules.md`, mục K). Quy tắc chung cho mọi plugin ở `../PLUGIN_RULES.md`.

**K1.** Một plugin duy nhất lo mặt: `face-recognition`. Worker tìm mặt
(BlazeFace), căn thẳng bằng mắt, mũi, miệng (`align.ts`) rồi chạy SFace bằng onnxruntime-web, trả về mỗi mặt **128
số** (base64 trong `attributes.embedding`). Ảnh không rời worker và không được lưu. Thư viện chạy mô hình và mô hình
đều khai trong `models.json` của plugin (có sha256), không có gì ngoài thư mục plugin.

**K2.** Khớp mặt là k-NN trên cosine (`matching.ts`, ngưỡng `MATCH_THRESHOLD` = 0,4; đo thật: cùng người 0,75, khác
người từ −0,03 đến 0,25). Đổi mô hình thì **đo lại** bằng ảnh có đáp án trước khi tin ngưỡng.

**K3.** Người, năm sinh, thông tin và các số mặt do **máy chủ** giữ (`assistant/models/people.py`, file
`assistant/data/people.json`, gitignore, ghi nguyên tử). Plugin chỉ gọi `/api/people`; quyền `network` và `screen`
ghi tay ở `permissions.ts`.

**K4.** Lưu bằng giọng nói đi qua từ khoá (`assistant/models/person_speech.py`), không qua mô hình ngôn ngữ (`rules.md` F1), rồi
thành lệnh `person` gửi cho trang. Core không biết plugin nào lo: `ModuleManager.command` đưa lệnh cho từng plugin đang
chạy, plugin nào xử lý thì trả câu để Hino nói (`VisionModule.command`), plugin không biết thì trả `null`.

**K5.** Khung nhãn của mặt đã biết tự viết cả nhãn (tên - năm sinh - thông tin, ngăn cách bằng dấu gạch ngang) và đặt `attributes.plainLabel` để Core
không thêm phần trăm phía sau.
