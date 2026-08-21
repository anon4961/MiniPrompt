/**
 * Mini Prompt - UI HTML 템플릿 (v2: 글로벌 세트 풀 + 적용 매핑)
 */

/**
 * 드로어 패널 - 글로벌 설정만 (슬림)
 */
export const DRAWER_HTML = `
<div class="mcp-container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Mini Prompt</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">

            <!-- 마스터 스위치 -->
            <div class="mcp-section">
                <label class="checkbox_label">
                    <input type="checkbox" id="mcp-master-enabled">
                    <span>확장 전체 활성화</span>
                </label>
                <small class="mcp-hint">끄면 모든 슬롯 주입이 중지됩니다.</small>
            </div>

            <hr class="mcp-hr">

            <!-- 슬롯 편집 진입 -->
            <div class="mcp-section">
                <button type="button" class="menu_button mcp-primary-btn" id="mcp-open-editor">
                    <i class="fa-solid fa-sliders"></i>
                    <span>Mini Prompt 열기</span>
                </button>
                <small class="mcp-hint">현재 채팅방·캐릭터에 세트를 적용하거나 세트를 편집합니다.</small>
            </div>

            <hr class="mcp-hr">

            <!-- 글로벌 설정 -->
            <div class="mcp-section">
                <div class="mcp-section-header">
                    <b>글로벌 설정</b>
                </div>
                <label class="checkbox_label">
                    <input type="checkbox" id="mcp-show-tokens">
                    <span>토큰 수 표시</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="mcp-confirm-delete">
                    <span>삭제 시 확인창 표시</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="mcp-show-slot-notes">
                    <span>슬롯 메모란 표시</span>
                </label>
            </div>

            <hr class="mcp-hr">

            <!-- 데이터 관리 -->
            <div class="mcp-section">
                <div class="mcp-section-header">
                    <b>데이터 관리</b>
                </div>
                <button type="button" class="menu_button mcp-small-btn" id="mcp-cleanup-orphan">
                    <i class="fa-solid fa-broom"></i>
                    <span>고아 적용 매핑 정리</span>
                </button>
                <small class="mcp-hint">삭제된 캐릭터/채팅의 적용 매핑만 정리합니다 (세트 자체는 안전).</small>
                <button type="button" class="menu_button mcp-small-btn mcp-danger-btn" id="mcp-purge-all" style="margin-top:8px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>전체 데이터 삭제</span>
                </button>
                <small class="mcp-hint">⚠️ 모든 세트와 적용 매핑을 삭제합니다.</small>
            </div>

        </div>
    </div>
</div>
`;

/**
 * 팝업 본체 - 두 메인 탭
 */
export const POPUP_HTML = `
<div class="mcp-popup-root">
    <h3 class="mcp-popup-title">
        <i class="fa-solid fa-sliders"></i>
        Mini Prompt
    </h3>

    <!-- 활성 세트 요약 -->
    <div class="mcp-summary-box" id="mcp-summary-box">
        <div class="mcp-summary-header">
            <i class="fa-solid fa-list-check"></i>
            <b>현재 적용 중인 세트</b>
        </div>
        <div class="mcp-summary-content" id="mcp-summary-content">
            <!-- 동적 렌더링 -->
        </div>
    </div>

    <!-- 메인 탭 -->
    <div class="mcp-main-tabs">
        <button type="button" class="menu_button mcp-main-tab-btn mcp-main-tab-active" data-main-tab="apply">
            <i class="fa-solid fa-link"></i>
            <span>현재 채팅방에 적용</span>
        </button>
        <button type="button" class="menu_button mcp-main-tab-btn" data-main-tab="manage">
            <i class="fa-solid fa-folder"></i>
            <span>세트 관리</span>
        </button>
    </div>

    <!-- 탭 1: 적용 -->
    <div class="mcp-tab-pane" id="mcp-tab-apply">
        <div class="mcp-current-target">
            <span id="mcp-current-target-label"></span>
        </div>

        <!-- 태그 필터 + 이름 검색 (아래 두 목록에 공통 적용) -->
        <div class="mcp-filter-bar">
            <select id="mcp-apply-tag-filter" class="text_pole mcp-filter-select" title="태그로 걸러보기"></select>
            <div class="mcp-filter-input-wrap">
                <i class="fa-solid fa-magnifying-glass mcp-filter-icon"></i>
                <input type="text" id="mcp-apply-name-search" class="text_pole mcp-filter-input" placeholder="세트 이름 검색">
                <button type="button" class="mcp-filter-clear" id="mcp-apply-search-clear" title="검색어 지우기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>

        <!-- 캐릭터별 적용 -->
        <div class="mcp-section">
            <div class="mcp-section-header">
                <b><i class="fa-solid fa-user"></i> 캐릭터에 적용</b>
                <span class="mcp-token-info" id="mcp-char-bind-info"></span>
            </div>
            <div id="mcp-char-bind-list" class="mcp-bind-list">
                <!-- 체크박스 목록 동적 -->
            </div>
        </div>

        <!-- 채팅방별 적용 -->
        <div class="mcp-section">
            <div class="mcp-section-header">
                <b><i class="fa-solid fa-message"></i> 이 채팅방에만 적용</b>
                <span class="mcp-token-info" id="mcp-chat-bind-info"></span>
            </div>
            <div id="mcp-chat-bind-list" class="mcp-bind-list">
                <!-- 체크박스 목록 동적 -->
            </div>
        </div>

        <hr class="mcp-hr">

        <!-- 프리뷰 -->
        <div class="mcp-section">
            <button type="button" class="menu_button mcp-small-btn" id="mcp-preview-btn">
                <i class="fa-solid fa-eye"></i>
                <span>주입 프리뷰</span>
            </button>
            <small class="mcp-hint">캐릭터+채팅방 모든 활성 슬롯을 합친 최종 주입 결과를 확인합니다.</small>
        </div>
    </div>

    <!-- 탭 2: 세트 관리 -->
    <div class="mcp-tab-pane" id="mcp-tab-manage" style="display:none;">

        <!-- 검색 영역 -->
        <div class="mcp-search-box">
            <div class="mcp-filter-input-wrap">
                <i class="fa-solid fa-magnifying-glass mcp-filter-icon"></i>
                <input type="text" id="mcp-global-search" class="text_pole mcp-filter-input" placeholder="전체 검색 (이름 · 내용 · 메모)">
                <button type="button" class="mcp-filter-clear" id="mcp-global-search-clear" title="검색어 지우기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="mcp-search-opts">
                <label class="checkbox_label mcp-search-opt"><input type="checkbox" id="mcp-search-names" checked><span>이름</span></label>
                <label class="checkbox_label mcp-search-opt"><input type="checkbox" id="mcp-search-content" checked><span>내용</span></label>
                <label class="checkbox_label mcp-search-opt"><input type="checkbox" id="mcp-search-notes" checked><span>메모</span></label>
            </div>
            <div id="mcp-search-results" class="mcp-search-results" style="display:none;"></div>
        </div>

        <div class="mcp-section">
            <div class="mcp-filter-bar">
                <select id="mcp-manage-tag-filter" class="text_pole mcp-filter-select" title="태그로 걸러보기"></select>
                <button type="button" class="menu_button mcp-small-btn" id="mcp-tag-manage-btn" title="태그 만들기 / 이름 변경 / 삭제">
                    <i class="fa-solid fa-tags"></i>
                    <span>태그 관리</span>
                </button>
            </div>
            <div class="mcp-set-controls">
                <select id="mcp-set-select" class="text_pole flex1"></select>
                <button type="button" class="menu_button mcp-icon-btn" id="mcp-set-add" title="세트 추가">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <button type="button" class="menu_button mcp-icon-btn" id="mcp-set-rename" title="세트 이름 변경">
                    <i class="fa-solid fa-pencil"></i>
                </button>
                <button type="button" class="menu_button mcp-icon-btn" id="mcp-set-delete" title="세트 삭제">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>

            <!-- 이 세트의 태그 -->
            <div class="mcp-set-tags-row">
                <span class="mcp-set-tags-label"><i class="fa-solid fa-tag"></i> 태그</span>
                <span id="mcp-set-tags" class="mcp-set-tags"></span>
                <button type="button" class="menu_button mcp-icon-btn" id="mcp-set-tags-edit" title="이 세트의 태그 지정">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>

            <!-- 세트 메모 -->
            <div class="mcp-note-row">
                <label class="mcp-note-label" for="mcp-set-note">
                    <i class="fa-solid fa-note-sticky"></i> 세트 메모
                    <small>(주입되지 않음)</small>
                </label>
                <textarea id="mcp-set-note" class="text_pole mcp-note-input" rows="2" placeholder="이 세트를 언제 쓰는지 등 메모"></textarea>
            </div>

            <div class="mcp-set-meta">
                <span id="mcp-set-usage-info" class="mcp-token-info"></span>
                <span id="mcp-set-token-info" class="mcp-token-info"></span>
            </div>
        </div>

        <hr class="mcp-hr">

        <!-- 슬롯 목록 -->
        <div class="mcp-section">
            <div class="mcp-section-header">
                <b>슬롯 목록</b>
                <div class="mcp-section-actions">
                    <button type="button" class="menu_button mcp-small-btn" id="mcp-slot-add">
                        <i class="fa-solid fa-plus"></i>
                        <span>슬롯 추가</span>
                    </button>
                    <button type="button" class="menu_button mcp-small-btn" id="mcp-slots-toggle-all" title="전체 활성/비활성">
                        <i class="fa-solid fa-toggle-on"></i>
                        <span>전체 토글</span>
                    </button>
                </div>
            </div>
            <div id="mcp-slot-list" class="mcp-slot-list">
                <div class="mcp-empty-msg">슬롯이 없습니다.</div>
            </div>
        </div>

        <hr class="mcp-hr">

        <!-- Export / Import -->
        <div class="mcp-section">
            <div class="mcp-io-buttons">
                <button type="button" class="menu_button mcp-small-btn" id="mcp-export-btn">
                    <i class="fa-solid fa-download"></i>
                    <span>현재 세트 내보내기</span>
                </button>
                <button type="button" class="menu_button mcp-small-btn" id="mcp-import-btn">
                    <i class="fa-solid fa-upload"></i>
                    <span>파일 불러오기</span>
                </button>
                <input type="file" id="mcp-import-file-input" accept=".json" style="display:none;">
            </div>
            <small class="mcp-hint">
                내보내기: 선택된 세트만 JSON 파일로 저장됩니다.<br>
                불러오기: 세트 풀에 추가됩니다. 옵션으로 현재 채팅방·캐릭터에 즉시 적용 가능.
            </small>
        </div>
    </div>
</div>
`;
