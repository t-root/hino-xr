# scene-description: mô tả cảnh

Ghi chú thiết kế của riêng plugin này (trước đây ở `rules.md`, mục M2). Quy tắc chung cho mọi plugin ở `../PLUGIN_RULES.md`.

**M2.** `scene-description` không thấy kết quả của plugin khác (`src/modules/PLUGIN_RULES.md` §2): nó chạy bộ nhận đồ vật riêng, mô hình riêng trong
thư mục của nó, và **không vẽ gì** (`detections: []`). Câu trả lời lấy số lượng lớn nhất của từng loại trong 2,5 giây gần
nhất, vì một khung có thể bỏ sót còn hai lần thấy thì không thành hai vật.
