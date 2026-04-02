# STT 뷰어 / 편집기

통화 음성인식(STT) 결과를 시각적으로 확인하고 편집하는 단일 HTML 파일 도구입니다.

## 실행 방법

`stt-editor.html` 파일을 **Chromium 또는 Chrome** 브라우저로 열면 됩니다.

> Firefox는 지원하지 않습니다. ([File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 미지원)

## 폴더 구조

```
recordings/
├── {대화ID}.wav
├── {대화ID}_left.json       # 고객 채널 STT 결과
├── {대화ID}_right.json      # 상담사 채널 STT 결과
├── {대화ID}_left_edit.json  # 고객 편집본 (자동 생성)
└── {대화ID}_right_edit.json # 상담사 편집본 (자동 생성)
```

wav 파일과 `_left.json`, `_right.json`이 같은 이름으로 존재하면 하나의 대화로 인식합니다.

### JSON 형식

```json
[
  {
    "sentence": "안녕하세요 무엇을 도와드릴까요",
    "word_pieces": [
      { "word": "안녕하세요", "start": 1200, "end": 1850 },
      { "word": "무엇을", "start": 1900, "end": 2200 },
      ...
    ]
  },
  ...
]
```

- `start` / `end`: 밀리초(ms) 단위 타임스탬프

## 사용법

1. 브라우저에서 `stt-editor.html` 열기
2. 좌측 사이드바의 **폴더 열기** 버튼 클릭 → `recordings` 폴더 선택
3. 좌측 목록에서 대화 선택
4. 탭 전환으로 원하는 뷰 확인

## 탭 설명

| 탭 | 설명 |
|---|---|
| **Word-piece** | 단어 단위로 채널 전환을 감지해 말풍선을 분리 |
| **인라인 병합** | 짧은 추임새는 인라인 칩으로 표시, 실질 발화는 병합 |
| **편집** | 단어 단위 STT 결과 수정, 수정 내용은 자동 저장 |

## 키보드 단축키

| 키 | 동작 |
|---|---|
| `Space` | 재생 / 일시정지 |
| `←` / `→` | 이전 / 다음 단어로 이동 (편집 탭: 이전/다음 단어 선택) |
| `↑` / `↓` | 화면 기준 위/아래 줄 단어로 이동 |
| `Enter` | 편집 탭: 선택 단어 편집 시작 / 저장 |
| `Esc` | 편집 탭: 편집 취소 |

## 편집 기능

- 편집 탭에서 단어를 **클릭**하면 선택, **더블클릭** 또는 **Enter**로 편집 모드 진입
- 편집 후 **Enter**로 저장 → `{대화ID}_{side}_edit.json`에 즉시 기록
- 수정된 단어는 초록색으로 표시, 헤더에 수정 개수 표시
- 폴더를 다시 열어도 편집 내용이 유지됨 (edit.json 참조)
- 편집본은 원본 JSON의 `word_pieces[i].word` 필드를 수정하는 방식으로 저장
