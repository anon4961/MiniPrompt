/**
 * Mini Prompt - UI 컨트롤러 (v3: 글로벌 풀 + 적용 매핑 + 태그/검색/메모)
 */

import { getContext } from '../../../../extensions.js';
import {
    EXTENSION_DISPLAY_NAME,
    LOG_PREFIX,
    LOG_PREFIX_DEV,
    POSITION_LABELS,
    TAG_FILTER_ALL,
    TAG_FILTER_UNTAGGED,
    UNTAGGED_LABEL,
    createEmptySlot,
} from './constants.js';
import { DRAWER_HTML, POPUP_HTML } from './templates.js';
import {
    getSettings,
    save,
    getCurrentCharacterKey,
    getCurrentChatKey,
    getAllSets,
    getSet,
    addSet,
    updateSet,
    deleteSet,
    addSlot,
    updateSlot,
    deleteSlot,
    reorderSlots,
    getBindings,
    bindSet,
    unbindSet,
    getSetUsage,
    findOrphanedBindings,
    removeOrphanedBindings,
    getActiveSetsSummary,
    purgeAllData,
    getAllTags,
    addTag,
    renameTag,
    deleteTag,
    getTagUsageCount,
    toggleSetTag,
} from './storage.js';
import { substituteMacros, estimateTokens } from './macros.js';
import { getPreviewMessages } from './injection.js';
import {
    exportSet,
    downloadAsFile,
    makeExportFilename,
    parseImportJson,
    importSet,
    checkImportConflict,
} from './import-export.js';
import { filterSets, searchAll, FIELD_LABELS } from './search.js';

// UI 상태
const uiState = {
    currentMainTab: 'apply',   // 'apply' | 'manage'
    currentSetId: null,        // 관리 탭에서 선택된 세트 ID
    popupInstance: null,
    // 필터/검색 (팝업 세션 동안 유지)
    applyTagFilter: TAG_FILTER_ALL,
    applyNameQuery: '',
    manageTagFilter: TAG_FILTER_ALL,
    searchQuery: '',
    searchOpts: { names: true, content: true, notes: true },
};

let _sortableInstance = null;
let _searchDebounceTimer = null;
let _applySearchDebounceTimer = null;

// ===== 유틸 =====

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toast(message, severity = 'info') {
    try {
        if (typeof toastr !== 'undefined' && toastr[severity]) {
            toastr[severity](message, EXTENSION_DISPLAY_NAME);
            return;
        }
    } catch (e) { /* fall through */ }
    console.log(`${LOG_PREFIX} ${message}`);
}

async function confirmDialog(message, title = EXTENSION_DISPLAY_NAME) {
    try {
        const ctx = getContext();
        if (ctx?.Popup?.show?.confirm) {
            return await ctx.Popup.show.confirm(title, message);
        }
    } catch (e) { /* fall through */ }
    return window.confirm(typeof message === 'string' ? message.replace(/<[^>]+>/g, '') : String(message));
}

async function inputDialog(message, defaultValue = '', title = EXTENSION_DISPLAY_NAME) {
    try {
        const ctx = getContext();
        if (ctx?.Popup?.show?.input) {
            return await ctx.Popup.show.input(title, message, defaultValue);
        }
    } catch (e) { /* fall through */ }
    return window.prompt(message, defaultValue);
}

async function textDialog(html, title = EXTENSION_DISPLAY_NAME) {
    try {
        const ctx = getContext();
        if (ctx?.Popup?.show?.text) {
            return await ctx.Popup.show.text(title, html);
        }
    } catch (e) { /* fall through */ }
    window.alert(typeof html === 'string' ? html.replace(/<[^>]+>/g, '') : String(html));
    return null;
}

// ===== 태그 필터 / 칩 =====

/**
 * 태그 필터 드롭다운 채우기
 * @param {string} selectId
 * @param {string} currentValue
 */
function populateTagFilter(selectId, currentValue) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const tags = getAllTags();
    const sets = getAllSets();
    const untaggedCount = sets.filter(s => !Array.isArray(s.tags) || s.tags.length === 0).length;

    const opts = [
        `<option value="${TAG_FILTER_ALL}">전체 (${sets.length})</option>`,
    ];
    for (const t of tags) {
        const cnt = sets.filter(s => Array.isArray(s.tags) && s.tags.includes(t)).length;
        opts.push(`<option value="${escapeHtml(t)}">${escapeHtml(t)} (${cnt})</option>`);
    }
    if (untaggedCount > 0) {
        opts.push(`<option value="${TAG_FILTER_UNTAGGED}">${UNTAGGED_LABEL} (${untaggedCount})</option>`);
    }
    select.innerHTML = opts.join('');

    // 현재 값이 유효하지 않으면 전체로 되돌림
    const valid = [TAG_FILTER_ALL, TAG_FILTER_UNTAGGED, ...tags];
    select.value = valid.includes(currentValue) ? currentValue : TAG_FILTER_ALL;
    return select.value;
}

/**
 * 태그 칩 HTML
 */
function renderTagChips(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return `<span class="mcp-tag-empty">${UNTAGGED_LABEL}</span>`;
    }
    return tags.map(t => `<span class="mcp-tag-chip">${escapeHtml(t)}</span>`).join('');
}

// ===== 활성 세트 요약 =====

function renderActiveSummary() {
    const el = document.getElementById('mcp-summary-content');
    if (!el) return;

    const summary = getActiveSetsSummary();

    if (!summary.masterEnabled) {
        el.innerHTML = '<div class="mcp-summary-empty">⚠️ 확장 전체가 비활성화되어 있습니다 (드로어 메뉴에서 켜세요)</div>';
        return;
    }

    const renderTags = (sets) => {
        if (sets.length === 0) {
            return '<span class="mcp-summary-empty-text">없음</span>';
        }
        return sets.map(s => {
            const cls = s.isDuplicate ? 'mcp-summary-tag mcp-summary-tag-on mcp-summary-tag-dup' : 'mcp-summary-tag mcp-summary-tag-on';
            const dupTitle = s.isDuplicate ? ' (캐릭터·채팅방 중복 — 1번만 주입됩니다)' : '';
            return `<span class="${cls}" title="${escapeHtml(s.name)}${dupTitle}">${escapeHtml(s.name)}${s.isDuplicate ? ' <small>⚠</small>' : ''} <small>(${s.activeSlots}/${s.totalSlots})</small></span>`;
        }).join(' ');
    };

    const dupCount = summary.duplicateSetIds?.size || 0;
    const dupNote = dupCount > 0
        ? `<div class="mcp-summary-dup-note">⚠ 중복 적용된 세트 ${dupCount}개는 1번만 주입됩니다</div>`
        : '';

    el.innerHTML = `
        <div class="mcp-summary-row">
            <span class="mcp-summary-label"><i class="fa-solid fa-user"></i> 캐릭터:</span>
            <span class="mcp-summary-tags">${renderTags(summary.characterSets)}</span>
        </div>
        <div class="mcp-summary-row">
            <span class="mcp-summary-label"><i class="fa-solid fa-message"></i> 채팅방:</span>
            <span class="mcp-summary-tags">${renderTags(summary.chatSets)}</span>
        </div>
        <div class="mcp-summary-total">
            합계: 실제 주입 슬롯 <b>${summary.totalActiveSlots}</b>개
        </div>
        ${dupNote}
    `;
}

// ===== 탭 1: 적용 =====

function updateCurrentTargetLabel() {
    const charKey = getCurrentCharacterKey();
    const chatKey = getCurrentChatKey();
    const labelEl = document.getElementById('mcp-current-target-label');
    if (!labelEl) return;
    if (!charKey && !chatKey) {
        labelEl.innerHTML = '⚠️ 캐릭터/채팅방을 선택해주세요';
        return;
    }
    const lines = [];
    if (charKey) lines.push(`캐릭터: <b>${escapeHtml(charKey)}</b>`);
    if (chatKey) lines.push(`채팅방: <b>${escapeHtml(chatKey)}</b>`);
    labelEl.innerHTML = lines.join('<br>');
}

/**
 * binding 체크박스 목록 렌더
 * @param {'character'|'chat'} scope
 */
function renderBindList(scope) {
    const listElId = scope === 'character' ? 'mcp-char-bind-list' : 'mcp-chat-bind-list';
    const infoElId = scope === 'character' ? 'mcp-char-bind-info' : 'mcp-chat-bind-info';
    const listEl = document.getElementById(listElId);
    const infoEl = document.getElementById(infoElId);
    if (!listEl) return;

    const targetKey = scope === 'character' ? getCurrentCharacterKey() : getCurrentChatKey();
    const allSets = getAllSets();

    if (!targetKey) {
        const what = scope === 'character' ? '캐릭터' : '채팅방';
        listEl.innerHTML = `<div class="mcp-empty-msg">${what}이 선택되지 않았습니다.</div>`;
        if (infoEl) infoEl.textContent = '';
        return;
    }

    if (allSets.length === 0) {
        listEl.innerHTML = '<div class="mcp-empty-msg">세트가 없습니다. "세트 관리" 탭에서 세트를 만드세요.</div>';
        if (infoEl) infoEl.textContent = '';
        return;
    }

    const boundIds = getBindings(scope, targetKey);

    // 다른 스코프에 이미 적용된 세트 ID (중복 경고용)
    const otherScope = scope === 'character' ? 'chat' : 'character';
    const otherTargetKey = otherScope === 'character' ? getCurrentCharacterKey() : getCurrentChatKey();
    const otherBoundIds = otherTargetKey ? new Set(getBindings(otherScope, otherTargetKey)) : new Set();

    // 태그 필터 + 이름 검색 적용
    const visibleSets = filterSets(allSets, uiState.applyTagFilter, uiState.applyNameQuery);

    if (visibleSets.length === 0) {
        listEl.innerHTML = '<div class="mcp-empty-msg">조건에 맞는 세트가 없습니다.</div>';
        updateBindInfo(scope);
        return;
    }

    // 정렬: 적용된 것 먼저, 그 다음 이름순
    const sortedSets = [...visibleSets].sort((a, b) => {
        const aBound = boundIds.includes(a.id);
        const bBound = boundIds.includes(b.id);
        if (aBound !== bBound) return aBound ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    listEl.innerHTML = sortedSets.map(s => {
        const checked = boundIds.includes(s.id);
        const slotCount = (s.slots || []).length;
        const activeCount = (s.slots || []).filter(sl => sl.enabled).length;
        const isDupWithOther = otherBoundIds.has(s.id);
        const dupBadge = (checked && isDupWithOther)
            ? '<span class="mcp-bind-dup-badge" title="다른 곳에도 적용되어 있어 한 번만 주입됩니다">⚠ 중복</span>'
            : '';
        const tagsText = (Array.isArray(s.tags) && s.tags.length > 0) ? s.tags.join(', ') : UNTAGGED_LABEL;
        const noteText = s.note ? `\n메모: ${s.note}` : '';
        const noteIcon = s.note
            ? '<i class="fa-solid fa-note-sticky mcp-bind-note-icon" title="메모 있음"></i>'
            : '';
        return `
        <label class="mcp-bind-item ${checked ? 'mcp-bind-item-on' : ''}" title="${escapeHtml(s.name)}\n태그: ${escapeHtml(tagsText)}${escapeHtml(noteText)}">
            <input type="checkbox" class="mcp-bind-checkbox" data-set-id="${escapeHtml(s.id)}" ${checked ? 'checked' : ''}>
            <span class="mcp-bind-name">${escapeHtml(s.name)}</span>
            ${noteIcon}
            ${dupBadge}
            <span class="mcp-bind-meta">${activeCount}/${slotCount} 슬롯</span>
        </label>`;
    }).join('');

    // 체크박스 이벤트 바인딩
    listEl.querySelectorAll('.mcp-bind-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const setId = cb.getAttribute('data-set-id');
            if (!setId) return;
            if (cb.checked) {
                bindSet(scope, targetKey, setId);
            } else {
                unbindSet(scope, targetKey, setId);
            }
            renderActiveSummary();
            // 양쪽 목록 모두 갱신 (중복 뱃지 동기화)
            cb.closest('.mcp-bind-item')?.classList.toggle('mcp-bind-item-on', cb.checked);
            renderBindList('character');
            renderBindList('chat');
        });
    });

    updateBindInfo(scope);
}

function updateBindInfo(scope) {
    const infoElId = scope === 'character' ? 'mcp-char-bind-info' : 'mcp-chat-bind-info';
    const infoEl = document.getElementById(infoElId);
    if (!infoEl) return;
    const targetKey = scope === 'character' ? getCurrentCharacterKey() : getCurrentChatKey();
    if (!targetKey) {
        infoEl.textContent = '';
        return;
    }
    const boundIds = getBindings(scope, targetKey);
    const filtering = uiState.applyTagFilter !== TAG_FILTER_ALL || !!uiState.applyNameQuery.trim();
    const visibleCount = filterSets(getAllSets(), uiState.applyTagFilter, uiState.applyNameQuery).length;
    infoEl.textContent = filtering
        ? `${boundIds.length}개 적용됨 · ${visibleCount}개 표시 중`
        : `${boundIds.length}개 적용됨`;
}

// ===== 탭 2: 세트 관리 =====

function refreshSetSelect() {
    const select = document.getElementById('mcp-set-select');
    if (!select) return;

    const all = getAllSets();
    const sets = filterSets(all, uiState.manageTagFilter, '')
        .sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML = '';
    if (sets.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = all.length === 0 ? '(세트 없음)' : '(이 태그에 세트 없음)';
        select.appendChild(opt);
        select.disabled = true;
        uiState.currentSetId = null;
    } else {
        select.disabled = false;
        for (const s of sets) {
            const opt = document.createElement('option');
            opt.value = s.id;
            const noteMark = s.note ? ' 📝' : '';
            opt.textContent = `${s.name}${noteMark}`;
            select.appendChild(opt);
        }
        if (!uiState.currentSetId || !sets.some(s => s.id === uiState.currentSetId)) {
            uiState.currentSetId = sets[0].id;
        }
        select.value = uiState.currentSetId;
    }
}

/**
 * 현재 세트의 태그 칩 + 메모 입력란 갱신
 */
function refreshSetTagsAndNote() {
    const tagsEl = document.getElementById('mcp-set-tags');
    const noteEl = document.getElementById('mcp-set-note');
    const editBtn = document.getElementById('mcp-set-tags-edit');

    const set = uiState.currentSetId ? getSet(uiState.currentSetId) : null;

    if (!set) {
        if (tagsEl) tagsEl.innerHTML = '<span class="mcp-tag-empty">—</span>';
        if (noteEl) {
            noteEl.value = '';
            noteEl.disabled = true;
        }
        if (editBtn) editBtn.disabled = true;
        return;
    }

    if (tagsEl) tagsEl.innerHTML = renderTagChips(set.tags);
    if (noteEl) {
        noteEl.disabled = false;
        // 사용자가 입력 중이면 덮어쓰지 않음
        if (document.activeElement !== noteEl) {
            noteEl.value = set.note || '';
        }
    }
    if (editBtn) editBtn.disabled = false;
}

function refreshSetMeta() {
    const tokenInfo = document.getElementById('mcp-set-token-info');
    const usageInfo = document.getElementById('mcp-set-usage-info');
    const settings = getSettings();

    if (!uiState.currentSetId) {
        if (tokenInfo) tokenInfo.textContent = '';
        if (usageInfo) usageInfo.textContent = '';
        return;
    }

    const set = getSet(uiState.currentSetId);
    if (!set) {
        if (tokenInfo) tokenInfo.textContent = '';
        if (usageInfo) usageInfo.textContent = '';
        return;
    }

    if (usageInfo) {
        const usage = getSetUsage(uiState.currentSetId);
        if (usage.total === 0) {
            usageInfo.textContent = '적용된 곳 없음';
        } else {
            const parts = [];
            if (usage.charCount > 0) parts.push(`캐릭터 ${usage.charCount}개`);
            if (usage.chatCount > 0) parts.push(`채팅방 ${usage.chatCount}개`);
            usageInfo.textContent = '적용 중: ' + parts.join(', ');
        }
    }

    if (tokenInfo && settings.ui?.showTokenCount) {
        const totalTokens = (set.slots || [])
            .filter(s => s.enabled)
            .reduce((sum, s) => sum + estimateTokens(substituteMacros(s.content || '')), 0);
        tokenInfo.textContent = `활성 슬롯 합계: ~${totalTokens} 토큰`;
    } else if (tokenInfo) {
        tokenInfo.textContent = '';
    }
}

function renderSlotCard(slot) {
    const settings = getSettings();
    const tokenCount = settings.ui?.showTokenCount
        ? estimateTokens(substituteMacros(slot.content || ''))
        : null;
    const isInChat = slot.position === 'in_chat';
    const showNotes = settings.ui?.showSlotNotes !== false;
    const cardCls = slot.enabled ? 'mcp-slot-card' : 'mcp-slot-card mcp-slot-disabled';

    return `
<div class="${cardCls}" data-slot-id="${escapeHtml(slot.id)}">
    <div class="mcp-slot-header">
        <div class="mcp-slot-handle" title="드래그하여 순서 변경">
            <i class="fa-solid fa-grip-vertical"></i>
        </div>
        <label class="checkbox_label mcp-slot-toggle" title="이 슬롯 활성/비활성">
            <input type="checkbox" class="mcp-slot-enabled" ${slot.enabled ? 'checked' : ''}>
        </label>
        <input type="text" class="text_pole mcp-slot-label" value="${escapeHtml(slot.label || '')}" placeholder="슬롯 이름">
        <button type="button" class="menu_button mcp-icon-btn mcp-slot-delete" title="슬롯 삭제">
            <i class="fa-solid fa-trash"></i>
        </button>
    </div>
    <div class="mcp-slot-body">
        <div class="mcp-slot-options">
            <div class="mcp-slot-radio-group">
                <label class="mcp-slot-radio">
                    <input type="radio" name="mcp-pos-${escapeHtml(slot.id)}" class="mcp-slot-position" value="before_main" ${slot.position === 'before_main' ? 'checked' : ''}>
                    <span>${escapeHtml(POSITION_LABELS.before_main)}</span>
                </label>
                <label class="mcp-slot-radio">
                    <input type="radio" name="mcp-pos-${escapeHtml(slot.id)}" class="mcp-slot-position" value="after_main" ${slot.position === 'after_main' ? 'checked' : ''}>
                    <span>${escapeHtml(POSITION_LABELS.after_main)}</span>
                </label>
                <label class="mcp-slot-radio">
                    <input type="radio" name="mcp-pos-${escapeHtml(slot.id)}" class="mcp-slot-position" value="in_chat" ${slot.position === 'in_chat' ? 'checked' : ''}>
                    <span title="주의: 같은 depth라도 작가노트보다 더 마지막 위치에 들어갑니다">${escapeHtml(POSITION_LABELS.in_chat)}</span>
                    <input type="number" class="text_pole mcp-slot-depth" min="0" max="100" value="${escapeHtml(String(slot.depth || 0))}" ${isInChat ? '' : 'disabled'}>
                    <span class="mcp-slot-as-label">as</span>
                    <select class="text_pole mcp-slot-role">
                        <option value="system" ${slot.role === 'system' ? 'selected' : ''}>System</option>
                        <option value="user" ${slot.role === 'user' ? 'selected' : ''}>User</option>
                        <option value="assistant" ${slot.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                    </select>
                </label>
            </div>
        </div>
        <textarea class="text_pole mcp-slot-content" rows="4" placeholder="여기에 주입할 프롬프트를 입력하세요. {{char}}, {{user}} 등 매크로 사용 가능">${escapeHtml(slot.content || '')}</textarea>
        ${showNotes ? `
        <div class="mcp-slot-note-row">
            <i class="fa-solid fa-note-sticky mcp-slot-note-icon" title="메모 (주입되지 않음)"></i>
            <input type="text" class="text_pole mcp-slot-note" value="${escapeHtml(slot.note || '')}" placeholder="메모 — 어떤 경우에 쓰는지 (주입 안 됨)">
        </div>` : ''}
        <div class="mcp-slot-footer">
            <span class="mcp-slot-token-info">${tokenCount !== null ? `~${tokenCount} 토큰` : ''}</span>
        </div>
    </div>
</div>`;
}

function refreshSlotList() {
    const listEl = document.getElementById('mcp-slot-list');
    if (!listEl) return;

    if (!uiState.currentSetId) {
        listEl.innerHTML = '<div class="mcp-empty-msg">세트를 선택하거나 추가하세요.</div>';
        destroySortable();
        return;
    }

    const set = getSet(uiState.currentSetId);
    if (!set || !Array.isArray(set.slots) || set.slots.length === 0) {
        listEl.innerHTML = '<div class="mcp-empty-msg">슬롯이 없습니다. "슬롯 추가" 버튼을 눌러 시작하세요.</div>';
        destroySortable();
        return;
    }

    listEl.innerHTML = set.slots.map(renderSlotCard).join('');
    bindSlotCardEvents();
    setupSortable(listEl);
}

function bindSlotCardEvents() {
    const listEl = document.getElementById('mcp-slot-list');
    if (!listEl) return;

    listEl.querySelectorAll('.mcp-slot-card').forEach(card => {
        const slotId = card.getAttribute('data-slot-id');
        if (!slotId) return;

        const enabledInput = card.querySelector('.mcp-slot-enabled');
        if (enabledInput) {
            enabledInput.addEventListener('change', () => {
                handleSlotUpdate(slotId, { enabled: enabledInput.checked });
                card.classList.toggle('mcp-slot-disabled', !enabledInput.checked);
                refreshSetMeta();
                renderActiveSummary();
            });
        }

        const labelInput = card.querySelector('.mcp-slot-label');
        if (labelInput) {
            labelInput.addEventListener('change', () => {
                handleSlotUpdate(slotId, { label: labelInput.value });
            });
        }

        const roleSelect = card.querySelector('.mcp-slot-role');
        if (roleSelect) {
            roleSelect.addEventListener('change', () => {
                handleSlotUpdate(slotId, { role: roleSelect.value });
            });
        }

        const posRadios = card.querySelectorAll('.mcp-slot-position');
        const depthInput = card.querySelector('.mcp-slot-depth');
        posRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                const newPos = radio.value;
                handleSlotUpdate(slotId, { position: newPos });
                if (depthInput) depthInput.disabled = (newPos !== 'in_chat');
            });
        });

        if (depthInput) {
            depthInput.addEventListener('change', () => {
                const v = Math.max(0, parseInt(depthInput.value, 10) || 0);
                handleSlotUpdate(slotId, { depth: v });
            });
        }

        const contentArea = card.querySelector('.mcp-slot-content');
        const tokenInfo = card.querySelector('.mcp-slot-token-info');
        if (contentArea) {
            contentArea.addEventListener('input', () => {
                if (tokenInfo) {
                    const settings = getSettings();
                    if (settings.ui?.showTokenCount) {
                        const t = estimateTokens(substituteMacros(contentArea.value || ''));
                        tokenInfo.textContent = `~${t} 토큰`;
                    }
                }
            });
            contentArea.addEventListener('change', () => {
                handleSlotUpdate(slotId, { content: contentArea.value });
                refreshSetMeta();
            });
        }

        const noteInput = card.querySelector('.mcp-slot-note');
        if (noteInput) {
            noteInput.addEventListener('change', () => {
                handleSlotUpdate(slotId, { note: noteInput.value });
            });
        }

        const deleteBtn = card.querySelector('.mcp-slot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => handleSlotDelete(slotId));
        }
    });
}

function handleSlotUpdate(slotId, updates) {
    if (!uiState.currentSetId) return;
    updateSlot(uiState.currentSetId, slotId, updates);
}

async function handleSlotDelete(slotId) {
    if (!uiState.currentSetId) return;

    const settings = getSettings();
    if (settings.ui?.confirmBeforeDelete) {
        const ok = await confirmDialog('이 슬롯을 삭제하시겠습니까?');
        if (!ok) return;
    }
    deleteSlot(uiState.currentSetId, slotId);
    refreshSlotList();
    refreshSetMeta();
    renderActiveSummary();
    toast('슬롯이 삭제되었습니다', 'success');
}

// ===== Sortable (jQuery UI) =====

function setupSortable(listEl) {
    destroySortable();
    if (typeof $ === 'undefined' || typeof $.fn?.sortable !== 'function') {
        return;
    }
    try {
        const $list = $(listEl);
        $list.sortable({
            handle: '.mcp-slot-handle',
            axis: 'y',
            tolerance: 'pointer',
            placeholder: 'mcp-sortable-placeholder',
            helper: 'clone',
            forcePlaceholderSize: true,
            cursor: 'grabbing',
            opacity: 0.7,
            update: function () {
                try {
                    const cards = listEl.querySelectorAll('.mcp-slot-card');
                    const newOrder = Array.from(cards).map(c => c.getAttribute('data-slot-id')).filter(Boolean);
                    if (uiState.currentSetId) {
                        reorderSlots(uiState.currentSetId, newOrder);
                    }
                } catch (e) {
                    console.error(`${LOG_PREFIX_DEV} sortable update 오류:`, e);
                }
            },
        });
        _sortableInstance = $list;
    } catch (e) {
        console.warn(`${LOG_PREFIX_DEV} jQuery UI sortable 초기화 실패:`, e);
    }
}

function destroySortable() {
    if (_sortableInstance) {
        try {
            if (_sortableInstance.sortable && typeof _sortableInstance.sortable === 'function') {
                _sortableInstance.sortable('destroy');
            }
        } catch (e) { /* ignore */ }
        _sortableInstance = null;
    }
}

// ===== 팝업 갱신 =====

function refreshApplyTab() {
    updateCurrentTargetLabel();
    uiState.applyTagFilter = populateTagFilter('mcp-apply-tag-filter', uiState.applyTagFilter) || TAG_FILTER_ALL;
    renderBindList('character');
    renderBindList('chat');
}

function refreshManageTab() {
    uiState.manageTagFilter = populateTagFilter('mcp-manage-tag-filter', uiState.manageTagFilter) || TAG_FILTER_ALL;
    refreshSetSelect();
    refreshSetTagsAndNote();
    refreshSetMeta();
    refreshSlotList();
    renderSearchResults();
}

function refreshPopup() {
    renderActiveSummary();
    if (uiState.currentMainTab === 'apply') {
        refreshApplyTab();
    } else {
        refreshManageTab();
    }
}

// ===== 검색 결과 =====

/**
 * 스니펫을 하이라이트 포함 HTML로
 */
function renderSnippet(sn) {
    if (!sn) return '';
    return `${escapeHtml(sn.before)}<mark class="mcp-search-hit">${escapeHtml(sn.match)}</mark>${escapeHtml(sn.after)}`;
}

function renderSearchResults() {
    const box = document.getElementById('mcp-search-results');
    if (!box) return;

    const q = uiState.searchQuery.trim();
    if (!q) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }

    const { results, truncated } = searchAll(getAllSets(), q, {
        searchNames: uiState.searchOpts.names,
        searchContent: uiState.searchOpts.content,
        searchNotes: uiState.searchOpts.notes,
        tagFilter: uiState.manageTagFilter,
    });

    box.style.display = '';

    if (results.length === 0) {
        box.innerHTML = '<div class="mcp-search-empty">검색 결과가 없습니다.</div>';
        return;
    }

    const header = `<div class="mcp-search-count">${results.length}건${truncated ? ' 이상 (상한 도달)' : ''}</div>`;
    const items = results.map((r, i) => `
        <div class="mcp-search-item" data-idx="${i}" data-set-id="${escapeHtml(r.setId)}" ${r.slotId ? `data-slot-id="${escapeHtml(r.slotId)}"` : ''}>
            <div class="mcp-search-item-head">
                <span class="mcp-search-set">${escapeHtml(r.setName)}</span>
                ${r.slotLabel ? `<span class="mcp-search-sep">›</span><span class="mcp-search-slot">${escapeHtml(r.slotLabel)}</span>` : ''}
                <span class="mcp-search-field">${escapeHtml(FIELD_LABELS[r.field] || r.field)}</span>
            </div>
            <div class="mcp-search-snippet">${renderSnippet(r.snippet)}</div>
        </div>
    `).join('');

    box.innerHTML = header + items;

    box.querySelectorAll('.mcp-search-item').forEach(el => {
        el.addEventListener('click', () => {
            const setId = el.getAttribute('data-set-id');
            const slotId = el.getAttribute('data-slot-id');
            jumpToSet(setId, slotId);
        });
    });
}

/**
 * 검색 결과 클릭 시 해당 세트/슬롯으로 이동
 */
function jumpToSet(setId, slotId) {
    if (!setId) return;
    const set = getSet(setId);
    if (!set) {
        toast('세트를 찾을 수 없습니다', 'warning');
        return;
    }

    // 현재 태그 필터에서 안 보이는 세트라면 필터를 전체로 되돌림
    const visible = filterSets(getAllSets(), uiState.manageTagFilter, '').some(s => s.id === setId);
    if (!visible) {
        uiState.manageTagFilter = TAG_FILTER_ALL;
        populateTagFilter('mcp-manage-tag-filter', uiState.manageTagFilter);
    }

    uiState.currentSetId = setId;
    refreshSetSelect();
    refreshSetTagsAndNote();
    refreshSetMeta();
    refreshSlotList();

    if (!slotId) return;

    // 슬롯 카드로 스크롤 + 일시 하이라이트
    setTimeout(() => {
        // CSS.escape 의존 없이 속성 비교로 찾음 (예외 가능성 차단)
        const cards = document.querySelectorAll('.mcp-slot-card');
        let card = null;
        for (const c of cards) {
            if (c.getAttribute('data-slot-id') === slotId) { card = c; break; }
        }
        if (!card) return;
        try {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
            card.scrollIntoView();
        }
        card.classList.add('mcp-slot-highlight');
        setTimeout(() => card.classList.remove('mcp-slot-highlight'), 2000);
    }, 60);
}

// ===== 태그 다이얼로그 =====

/**
 * 이 세트의 태그 지정 다이얼로그 (체크박스 + 새 태그 추가)
 */
async function showSetTagsDialog() {
    if (!uiState.currentSetId) return;
    const set = getSet(uiState.currentSetId);
    if (!set) return;

    const buildHtml = () => {
        const cur = getSet(uiState.currentSetId);
        const tags = getAllTags();
        const list = tags.length === 0
            ? '<div class="mcp-search-empty">태그가 없습니다. 아래에서 새로 만들어보세요.</div>'
            : tags.map(t => `
                <label class="mcp-bind-item ${cur.tags?.includes(t) ? 'mcp-bind-item-on' : ''}">
                    <input type="checkbox" class="mcp-tagdlg-cb" data-tag="${escapeHtml(t)}" ${cur.tags?.includes(t) ? 'checked' : ''}>
                    <span class="mcp-bind-name">${escapeHtml(t)}</span>
                </label>`).join('');
        return `
<div class="mcp-dialog-content">
    <p><b>${escapeHtml(cur.name)}</b> 의 태그를 지정합니다.</p>
    <div class="mcp-bind-list mcp-tagdlg-list">${list}</div>
    <div class="mcp-filter-bar" style="margin-top:10px;">
        <input type="text" id="mcp-tagdlg-new" class="text_pole flex1" placeholder="새 태그 이름">
        <button type="button" class="menu_button mcp-small-btn" id="mcp-tagdlg-add">
            <i class="fa-solid fa-plus"></i><span>추가</span>
        </button>
    </div>
</div>`;
    };

    const bind = () => {
        document.querySelectorAll('.mcp-tagdlg-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const tag = cb.getAttribute('data-tag');
                if (!tag) return;
                toggleSetTag(uiState.currentSetId, tag);
                cb.closest('.mcp-bind-item')?.classList.toggle('mcp-bind-item-on', cb.checked);
                refreshSetTagsAndNote();
            });
        });
        const addBtn = document.getElementById('mcp-tagdlg-add');
        const newInput = document.getElementById('mcp-tagdlg-new');
        const doAdd = () => {
            const name = (newInput?.value || '').trim();
            if (!name) return;
            addTag(name);
            toggleSetTag(uiState.currentSetId, name);
            if (newInput) newInput.value = '';
            // 목록 다시 그리기
            const listEl = document.querySelector('.mcp-tagdlg-list');
            if (listEl) {
                const cur = getSet(uiState.currentSetId);
                listEl.innerHTML = getAllTags().map(t => `
                    <label class="mcp-bind-item ${cur.tags?.includes(t) ? 'mcp-bind-item-on' : ''}">
                        <input type="checkbox" class="mcp-tagdlg-cb" data-tag="${escapeHtml(t)}" ${cur.tags?.includes(t) ? 'checked' : ''}>
                        <span class="mcp-bind-name">${escapeHtml(t)}</span>
                    </label>`).join('');
                bind();
            }
            refreshSetTagsAndNote();
        };
        if (addBtn) addBtn.addEventListener('click', doAdd);
        if (newInput) {
            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
            });
        }
    };

    try {
        const ctx = getContext();
        if (ctx?.Popup) {
            const popup = new ctx.Popup(buildHtml(), ctx.POPUP_TYPE.TEXT, '', { okButton: '완료' });
            const p = popup.show();
            setTimeout(bind, 60);
            await p;
        } else {
            await textDialog('이 환경에서는 태그 편집 창을 열 수 없습니다.');
        }
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} 태그 다이얼로그 오류:`, e);
    }

    // 닫힌 후 전체 갱신
    refreshManageTab();
    renderActiveSummary();
}

/**
 * 전역 태그 관리 다이얼로그 (추가 / 이름 변경 / 삭제)
 */
async function showTagManageDialog() {
    const buildList = () => {
        const tags = getAllTags();
        if (tags.length === 0) {
            return '<div class="mcp-search-empty">태그가 없습니다.</div>';
        }
        return tags.map(t => `
            <div class="mcp-bind-item mcp-tagmgr-item">
                <span class="mcp-bind-name">${escapeHtml(t)}</span>
                <span class="mcp-bind-meta">${getTagUsageCount(t)}개 세트</span>
                <button type="button" class="menu_button mcp-icon-btn mcp-tagmgr-rename" data-tag="${escapeHtml(t)}" title="이름 변경">
                    <i class="fa-solid fa-pencil"></i>
                </button>
                <button type="button" class="menu_button mcp-icon-btn mcp-tagmgr-delete" data-tag="${escapeHtml(t)}" title="태그 삭제 (세트는 유지)">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>`).join('');
    };

    const html = `
<div class="mcp-dialog-content">
    <p>태그를 만들거나 정리합니다. <b>태그를 삭제해도 세트는 삭제되지 않습니다.</b></p>
    <div class="mcp-bind-list mcp-tagmgr-list">${buildList()}</div>
    <div class="mcp-filter-bar" style="margin-top:10px;">
        <input type="text" id="mcp-tagmgr-new" class="text_pole flex1" placeholder="새 태그 이름">
        <button type="button" class="menu_button mcp-small-btn" id="mcp-tagmgr-add">
            <i class="fa-solid fa-plus"></i><span>추가</span>
        </button>
    </div>
</div>`;

    const rerender = () => {
        const listEl = document.querySelector('.mcp-tagmgr-list');
        if (!listEl) return;
        listEl.innerHTML = buildList();
        bind();
    };

    const bind = () => {
        document.querySelectorAll('.mcp-tagmgr-rename').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.getAttribute('data-tag');
                if (!tag) return;
                const next = await inputDialog(`"${tag}" 의 새 이름:`, tag);
                if (!next || !next.trim() || next.trim() === tag) return;
                const ok = renameTag(tag, next.trim());
                if (!ok) {
                    toast('이름을 변경하지 못했습니다 (중복된 이름일 수 있음)', 'warning');
                    return;
                }
                rerender();
                toast('태그 이름을 변경했습니다', 'success');
            });
        });
        document.querySelectorAll('.mcp-tagmgr-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.getAttribute('data-tag');
                if (!tag) return;
                const used = getTagUsageCount(tag);
                const settings = getSettings();
                if (settings.ui?.confirmBeforeDelete) {
                    const msg = used > 0
                        ? `태그 "${tag}" 를 삭제합니다.\n${used}개 세트에서 이 태그만 제거되며, 세트 자체는 삭제되지 않습니다.`
                        : `태그 "${tag}" 를 삭제합니다.`;
                    const ok = await confirmDialog(msg);
                    if (!ok) return;
                }
                const affected = deleteTag(tag);
                rerender();
                toast(`태그 삭제됨 (세트 ${affected}개에서 제거)`, 'success');
            });
        });
        const addBtn = document.getElementById('mcp-tagmgr-add');
        const newInput = document.getElementById('mcp-tagmgr-new');
        const doAdd = () => {
            const name = (newInput?.value || '').trim();
            if (!name) return;
            if (!addTag(name)) {
                toast('이미 있는 태그입니다', 'warning');
                return;
            }
            if (newInput) newInput.value = '';
            rerender();
        };
        if (addBtn) addBtn.addEventListener('click', doAdd);
        if (newInput) {
            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
            });
        }
    };

    try {
        const ctx = getContext();
        if (ctx?.Popup) {
            const popup = new ctx.Popup(html, ctx.POPUP_TYPE.TEXT, '', { okButton: '완료' });
            const p = popup.show();
            setTimeout(bind, 60);
            await p;
        } else {
            await textDialog('이 환경에서는 태그 관리 창을 열 수 없습니다.');
        }
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} 태그 관리 다이얼로그 오류:`, e);
    }

    refreshManageTab();
    refreshApplyTab();
    renderActiveSummary();
}

// ===== 메인 탭 전환 =====

function switchMainTab(tabName) {
    if (!['apply', 'manage'].includes(tabName)) return;
    uiState.currentMainTab = tabName;

    document.querySelectorAll('.mcp-main-tab-btn').forEach(b => {
        const isActive = b.getAttribute('data-main-tab') === tabName;
        b.classList.toggle('mcp-main-tab-active', isActive);
    });
    const applyPane = document.getElementById('mcp-tab-apply');
    const managePane = document.getElementById('mcp-tab-manage');
    if (applyPane) applyPane.style.display = (tabName === 'apply') ? '' : 'none';
    if (managePane) managePane.style.display = (tabName === 'manage') ? '' : 'none';

    if (tabName === 'apply') {
        refreshApplyTab();
    } else {
        refreshManageTab();
    }
}

// ===== 팝업 컨트롤 바인딩 =====

function bindPopupControls() {
    // 메인 탭 전환
    document.querySelectorAll('.mcp-main-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-main-tab');
            if (tab) switchMainTab(tab);
        });
    });

    // --- 적용 탭: 태그 필터 + 이름 검색 ---
    const applyTagFilter = document.getElementById('mcp-apply-tag-filter');
    if (applyTagFilter) {
        applyTagFilter.addEventListener('change', () => {
            uiState.applyTagFilter = applyTagFilter.value || TAG_FILTER_ALL;
            renderBindList('character');
            renderBindList('chat');
        });
    }
    const applyNameSearch = document.getElementById('mcp-apply-name-search');
    if (applyNameSearch) {
        applyNameSearch.value = uiState.applyNameQuery;
        applyNameSearch.addEventListener('input', () => {
            clearTimeout(_applySearchDebounceTimer);
            _applySearchDebounceTimer = setTimeout(() => {
                uiState.applyNameQuery = applyNameSearch.value;
                renderBindList('character');
                renderBindList('chat');
            }, 200);
        });
    }
    const applySearchClear = document.getElementById('mcp-apply-search-clear');
    if (applySearchClear) {
        applySearchClear.addEventListener('click', () => {
            uiState.applyNameQuery = '';
            if (applyNameSearch) applyNameSearch.value = '';
            renderBindList('character');
            renderBindList('chat');
        });
    }

    // --- 관리 탭: 전체 검색 ---
    const globalSearch = document.getElementById('mcp-global-search');
    if (globalSearch) {
        globalSearch.value = uiState.searchQuery;
        globalSearch.addEventListener('input', () => {
            clearTimeout(_searchDebounceTimer);
            _searchDebounceTimer = setTimeout(() => {
                uiState.searchQuery = globalSearch.value;
                renderSearchResults();
            }, 200);
        });
    }
    const globalSearchClear = document.getElementById('mcp-global-search-clear');
    if (globalSearchClear) {
        globalSearchClear.addEventListener('click', () => {
            uiState.searchQuery = '';
            if (globalSearch) globalSearch.value = '';
            renderSearchResults();
        });
    }
    [['mcp-search-names', 'names'], ['mcp-search-content', 'content'], ['mcp-search-notes', 'notes']]
        .forEach(([id, key]) => {
            const cb = document.getElementById(id);
            if (!cb) return;
            cb.checked = !!uiState.searchOpts[key];
            cb.addEventListener('change', () => {
                uiState.searchOpts[key] = cb.checked;
                renderSearchResults();
            });
        });

    // --- 관리 탭: 태그 필터 / 태그 관리 ---
    const manageTagFilter = document.getElementById('mcp-manage-tag-filter');
    if (manageTagFilter) {
        manageTagFilter.addEventListener('change', () => {
            uiState.manageTagFilter = manageTagFilter.value || TAG_FILTER_ALL;
            refreshSetSelect();
            refreshSetTagsAndNote();
            refreshSetMeta();
            refreshSlotList();
            renderSearchResults();
        });
    }
    const tagManageBtn = document.getElementById('mcp-tag-manage-btn');
    if (tagManageBtn) {
        tagManageBtn.addEventListener('click', () => showTagManageDialog());
    }
    const setTagsEdit = document.getElementById('mcp-set-tags-edit');
    if (setTagsEdit) {
        setTagsEdit.addEventListener('click', () => showSetTagsDialog());
    }

    // --- 세트 메모 ---
    const setNote = document.getElementById('mcp-set-note');
    if (setNote) {
        setNote.addEventListener('change', () => {
            if (!uiState.currentSetId) return;
            updateSet(uiState.currentSetId, { note: setNote.value });
            refreshSetSelect();
            const sel = document.getElementById('mcp-set-select');
            if (sel) sel.value = uiState.currentSetId;
        });
    }

    // 세트 선택
    const setSelect = document.getElementById('mcp-set-select');
    if (setSelect) {
        setSelect.addEventListener('change', () => {
            uiState.currentSetId = setSelect.value || null;
            refreshSetTagsAndNote();
            refreshSetMeta();
            refreshSlotList();
        });
    }

    // 세트 추가
    const setAdd = document.getElementById('mcp-set-add');
    if (setAdd) {
        setAdd.addEventListener('click', async () => {
            const name = await inputDialog('새 세트 이름:', '새 세트');
            if (!name || !name.trim()) return;
            const newSet = addSet(name.trim());
            if (newSet) {
                uiState.currentSetId = newSet.id;
                // 새 세트는 태그가 없으므로, 특정 태그 필터 중이면 전체로 되돌려 보이게 함
                if (uiState.manageTagFilter !== TAG_FILTER_ALL) {
                    uiState.manageTagFilter = TAG_FILTER_ALL;
                }
                refreshManageTab();
                renderActiveSummary();
                // 적용 탭이 열려있을 수도 있으니 갱신
                if (document.getElementById('mcp-char-bind-list')) {
                    refreshApplyTab();
                }
                toast('세트가 추가되었습니다', 'success');
            }
        });
    }

    // 세트 이름 변경
    const setRename = document.getElementById('mcp-set-rename');
    if (setRename) {
        setRename.addEventListener('click', async () => {
            if (!uiState.currentSetId) return;
            const set = getSet(uiState.currentSetId);
            if (!set) return;
            const newName = await inputDialog('새 이름:', set.name);
            if (!newName || !newName.trim()) return;
            updateSet(uiState.currentSetId, { name: newName.trim() });
            refreshSetSelect();
            const select = document.getElementById('mcp-set-select');
            if (select) select.value = uiState.currentSetId;
            refreshSetTagsAndNote();
            renderSearchResults();
            renderActiveSummary();
        });
    }

    // 세트 삭제
    const setDelete = document.getElementById('mcp-set-delete');
    if (setDelete) {
        setDelete.addEventListener('click', async () => {
            if (!uiState.currentSetId) return;
            const set = getSet(uiState.currentSetId);
            if (!set) return;
            const usage = getSetUsage(uiState.currentSetId);
            const settings = getSettings();
            if (settings.ui?.confirmBeforeDelete) {
                let msg = `세트 "${set.name}"을(를) 삭제하시겠습니까?\n슬롯도 모두 삭제됩니다.`;
                if (usage.total > 0) {
                    msg += `\n\n⚠️ 이 세트는 현재 적용 중입니다:\n`;
                    if (usage.charCount > 0) msg += `- 캐릭터 ${usage.charCount}개\n`;
                    if (usage.chatCount > 0) msg += `- 채팅방 ${usage.chatCount}개\n`;
                    msg += `삭제하면 모든 적용 매핑도 함께 제거됩니다.`;
                }
                const ok = await confirmDialog(msg);
                if (!ok) return;
            }
            deleteSet(uiState.currentSetId);
            uiState.currentSetId = null;
            refreshManageTab();
            renderActiveSummary();
            // 적용 탭도 갱신 필요
            if (document.getElementById('mcp-char-bind-list')) {
                refreshApplyTab();
            }
            toast('세트가 삭제되었습니다', 'success');
        });
    }

    // 슬롯 추가
    const slotAdd = document.getElementById('mcp-slot-add');
    if (slotAdd) {
        slotAdd.addEventListener('click', () => {
            if (!uiState.currentSetId) {
                toast('먼저 세트를 추가/선택해주세요', 'warning');
                return;
            }
            const newSlot = createEmptySlot('새 슬롯');
            addSlot(uiState.currentSetId, newSlot);
            refreshSlotList();
            refreshSetMeta();
            renderActiveSummary();
        });
    }

    // 전체 토글
    const slotsToggleAll = document.getElementById('mcp-slots-toggle-all');
    if (slotsToggleAll) {
        slotsToggleAll.addEventListener('click', () => {
            if (!uiState.currentSetId) return;
            const set = getSet(uiState.currentSetId);
            if (!set || !Array.isArray(set.slots) || set.slots.length === 0) return;
            const allOn = set.slots.every(s => s.enabled);
            for (const s of set.slots) {
                updateSlot(uiState.currentSetId, s.id, { enabled: !allOn });
            }
            refreshSlotList();
            refreshSetMeta();
            renderActiveSummary();
        });
    }

    // Export
    const exportBtn = document.getElementById('mcp-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!uiState.currentSetId) {
                toast('내보낼 세트가 없습니다', 'warning');
                return;
            }
            const set = getSet(uiState.currentSetId);
            if (!set) return;
            const json = exportSet(uiState.currentSetId);
            if (!json) {
                toast('내보내기 실패', 'error');
                return;
            }
            const filename = makeExportFilename(set.name);
            const ok = downloadAsFile(filename, json);
            if (ok) toast(`내보내기 완료: ${filename}`, 'success');
            else toast('파일 다운로드 실패', 'error');
        });
    }

    // Import
    const importBtn = document.getElementById('mcp-import-btn');
    const fileInput = document.getElementById('mcp-import-file-input');
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.value = '';
            fileInput.click();
        });
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await handleImportFile(file);
        });
    }

    // 프리뷰
    const previewBtn = document.getElementById('mcp-preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', () => showPreviewDialog());
    }
}

// ===== Import 처리 =====

async function handleImportFile(file) {
    try {
        const text = await file.text();
        const result = parseImportJson(text);
        if (!result.valid) {
            toast(`불러오기 실패: ${result.error}`, 'error');
            return;
        }

        // 충돌 검사
        const conflict = checkImportConflict(result.data);
        let conflictMode = 'rename';
        if (conflict.hasConflict) {
            const choice = await showConflictDialog(conflict);
            if (choice === null) return;
            conflictMode = choice;
        }

        // 자동 적용 옵션
        const autoApply = await showAutoApplyDialog();
        if (autoApply === false) return;  // 취소

        const importResult = importSet(result.data, conflictMode, autoApply || null);
        if (importResult.success) {
            uiState.currentSetId = importResult.set.id;
            refreshPopup();
            toast(`불러오기 완료: ${importResult.set.name}`, 'success');
        } else {
            toast(`불러오기 실패: ${importResult.error}`, 'error');
        }
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} Import 오류:`, e);
        toast(`불러오기 실패: ${e.message}`, 'error');
    }
}

async function showConflictDialog(conflict) {
    const html = `
<div class="mcp-dialog-content">
    <p>이미 같은 이름의 세트가 있습니다:</p>
    <p><b>${escapeHtml(conflict.importSetName)}</b></p>
    <p>어떻게 처리할까요?</p>
    <div class="mcp-dialog-buttons">
        <button type="button" class="menu_button mcp-dialog-btn" data-mcp-choice="rename">이름 변경 후 추가 (권장)</button>
        <button type="button" class="menu_button mcp-dialog-btn" data-mcp-choice="overwrite">기존 세트 덮어쓰기</button>
        <button type="button" class="menu_button mcp-dialog-btn" data-mcp-choice="append">같은 이름으로 추가</button>
    </div>
</div>`;

    return new Promise((resolve) => {
        try {
            const ctx = getContext();
            if (ctx?.Popup) {
                const popup = new ctx.Popup(html, ctx.POPUP_TYPE.TEXT, '', {
                    okButton: '취소',
                    wide: false,
                });
                popup.show();

                setTimeout(() => {
                    document.querySelectorAll('[data-mcp-choice]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const choice = btn.getAttribute('data-mcp-choice');
                            try { popup.complete(0); } catch (e) { /* ignore */ }
                            resolve(choice);
                        });
                    });
                }, 100);

                popup.completePromise?.then(() => resolve(null)).catch(() => resolve(null));
                return;
            }
        } catch (e) {
            console.warn(`${LOG_PREFIX_DEV} 충돌 다이얼로그 폴백:`, e);
        }

        const choice = window.prompt(
            `이미 같은 이름의 세트가 있습니다: ${conflict.importSetName}\n` +
            `1=이름 변경, 2=덮어쓰기, 3=같은 이름 추가, 그 외=취소`,
            '1'
        );
        if (choice === '1') resolve('rename');
        else if (choice === '2') resolve('overwrite');
        else if (choice === '3') resolve('append');
        else resolve(null);
    });
}

/**
 * Import 후 자동 적용 다이얼로그
 * @returns {Promise<{scope, targetKey} | null | false>}
 *   객체: 자동 적용 / null: 풀에만 추가 / false: 취소
 */
async function showAutoApplyDialog() {
    const charKey = getCurrentCharacterKey();
    const chatKey = getCurrentChatKey();

    if (!charKey && !chatKey) {
        // 적용할 컨텍스트 없음 → 그냥 풀에만
        return null;
    }

    const html = `
<div class="mcp-dialog-content">
    <p>불러온 세트를 어디에 적용할까요?</p>
    <div class="mcp-dialog-buttons">
        ${chatKey ? `<button type="button" class="menu_button mcp-dialog-btn" data-mcp-target="chat"><i class="fa-solid fa-message"></i> 현재 채팅방에 적용</button>` : ''}
        ${charKey ? `<button type="button" class="menu_button mcp-dialog-btn" data-mcp-target="character"><i class="fa-solid fa-user"></i> 현재 캐릭터에 적용</button>` : ''}
        <button type="button" class="menu_button mcp-dialog-btn" data-mcp-target="none">세트 풀에만 추가 (적용 안 함)</button>
    </div>
</div>`;

    return new Promise((resolve) => {
        try {
            const ctx = getContext();
            if (ctx?.Popup) {
                const popup = new ctx.Popup(html, ctx.POPUP_TYPE.TEXT, '', {
                    okButton: '취소',
                    wide: false,
                });
                popup.show();

                setTimeout(() => {
                    document.querySelectorAll('[data-mcp-target]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const target = btn.getAttribute('data-mcp-target');
                            try { popup.complete(0); } catch (e) { /* ignore */ }
                            if (target === 'character') resolve({ scope: 'character', targetKey: charKey });
                            else if (target === 'chat') resolve({ scope: 'chat', targetKey: chatKey });
                            else resolve(null);
                        });
                    });
                }, 100);

                popup.completePromise?.then(() => resolve(false)).catch(() => resolve(false));
                return;
            }
        } catch (e) {
            console.warn(`${LOG_PREFIX_DEV} 자동 적용 다이얼로그 폴백:`, e);
        }

        // 폴백
        const choice = window.prompt(
            '불러온 세트를 어디에 적용할까요?\n' +
            (chatKey ? '1=현재 채팅방에 적용\n' : '') +
            (charKey ? '2=현재 캐릭터에 적용\n' : '') +
            '3=세트 풀에만 추가',
            '1'
        );
        if (choice === '1' && chatKey) resolve({ scope: 'chat', targetKey: chatKey });
        else if (choice === '2' && charKey) resolve({ scope: 'character', targetKey: charKey });
        else if (choice === '3') resolve(null);
        else resolve(false);
    });
}

// ===== 프리뷰 =====

async function showPreviewDialog() {
    const messages = getPreviewMessages();
    if (messages.length === 0) {
        await textDialog('현재 활성화된 슬롯이 없습니다.');
        return;
    }

    let totalTokens = 0;
    const messagesWithTokens = messages.map(m => {
        const tokens = estimateTokens(m.content || '');
        totalTokens += tokens;
        return { ...m, _tokens: tokens };
    });

    // 위치 그룹별 시각 구분을 위해 직전 슬롯과 비교
    const positionLabel = (pos) => {
        if (pos === 'before_main') return '메인 이전';
        if (pos === 'after_main') return '메인 이후';
        return '채팅 내';
    };

    let prevGroup = null;
    const renderedItems = messagesWithTokens.map((m, i) => {
        // 그룹 키: 같은 position + 같은 depth(in_chat의 경우)
        const groupKey = m._position === 'in_chat' ? `in_chat_${m._depth}` : m._position;
        const showHeader = groupKey !== prevGroup;
        prevGroup = groupKey;

        const groupHeader = showHeader ? `
            <div class="mcp-preview-group-header">
                ${escapeHtml(positionLabel(m._position))}${m._position === 'in_chat' ? ` (depth: ${m._depth})` : ''}
            </div>` : '';

        return `
            ${groupHeader}
            <div class="mcp-preview-msg">
                <div class="mcp-preview-msg-header">
                    <span><b>#${i+1}</b> [${escapeHtml(m.role)}] ${escapeHtml(m._label || '')}</span>
                    <span>${escapeHtml(m._scope === 'character' ? '캐릭터' : '채팅')} / ${escapeHtml(m._setName || '')} · ~${m._tokens} 토큰</span>
                </div>
                <div class="mcp-preview-msg-content">${escapeHtml(m.content || '')}</div>
            </div>
        `;
    }).join('');

    const html = `
<div class="mcp-preview-content">
    <div class="mcp-preview-summary">
        <div>주입될 메시지: <b>${messages.length}</b>개 (캐릭터+채팅방 합산, 중복 세트 제외)</div>
        <div>총 토큰 수 (추정): <b>${totalTokens}</b></div>
        <div class="mcp-preview-summary-note">실제 주입 순서대로 표시됩니다 (위 → 아래로 갈수록 AI에 강한 영향)</div>
    </div>
    ${renderedItems}
</div>`;

    await textDialog(html, '주입 프리뷰');
}

// ===== 고아 binding 정리 =====

async function showOrphanDialog() {
    const result = findOrphanedBindings();
    const totalOrphan = result.orphanedCharacters.length + result.orphanedChats.length;
    if (totalOrphan === 0) {
        await textDialog('고아 적용 매핑이 없습니다. 모든 매핑이 유효한 캐릭터/채팅방을 가리킵니다.');
        return;
    }

    const html = `
<div>
    <p>다음 적용 매핑은 더 이상 존재하지 않는 캐릭터/채팅방을 가리킵니다:</p>
    ${result.orphanedCharacters.length > 0 ? `
        <div style="margin-top: 10px;">
            <b>고아 캐릭터 매핑 (${result.orphanedCharacters.length}개):</b>
            <ul style="max-height: 150px; overflow-y: auto; margin: 4px 0;">
                ${result.orphanedCharacters.map(k => `<li>${escapeHtml(k)}</li>`).join('')}
            </ul>
        </div>
    ` : ''}
    ${result.orphanedChats.length > 0 ? `
        <div style="margin-top: 10px;">
            <b>고아 채팅 매핑 (${result.orphanedChats.length}개):</b>
            <ul style="max-height: 150px; overflow-y: auto; margin: 4px 0;">
                ${result.orphanedChats.map(k => `<li>${escapeHtml(k)}</li>`).join('')}
            </ul>
        </div>
    ` : ''}
    <p style="margin-top: 10px; color: #d97706;">⚠️ 매핑만 정리되며, 세트 자체는 안전합니다.</p>
</div>`;

    const ok = await confirmDialog(html, '고아 매핑 정리');
    if (!ok) return;

    const removed = removeOrphanedBindings(result.orphanedCharacters, result.orphanedChats);
    toast(`정리 완료: 캐릭터 ${removed.removedChars}개 / 채팅 ${removed.removedChats}개 매핑 삭제`, 'success');
}

async function showPurgeAllDialog() {
    const settings = getSettings();
    const setCount = Object.keys(settings.sets || {}).length;
    const charBindCount = Object.keys(settings.bindings.characters || {}).length;
    const chatBindCount = Object.keys(settings.bindings.chats || {}).length;

    if (setCount === 0 && charBindCount === 0 && chatBindCount === 0) {
        await textDialog('삭제할 데이터가 없습니다.');
        return;
    }

    const firstHtml = `
<div>
    <p style="color:#dc2626; font-weight:bold; font-size:1.1em;">
        ⚠️ 모든 Mini Prompt 데이터를 삭제합니다
    </p>
    <ul style="margin: 8px 0; line-height: 1.6;">
        <li>세트: <b>${setCount}개</b> (모든 슬롯 포함)</li>
        <li>캐릭터 적용 매핑: <b>${charBindCount}개</b></li>
        <li>채팅방 적용 매핑: <b>${chatBindCount}개</b></li>
    </ul>
    <p>이 작업은 <b>되돌릴 수 없습니다.</b></p>
    <p style="margin-top: 10px;">삭제 전에 필요한 세트는 반드시 <b>Export로 백업</b>해주세요.</p>
    <p style="margin-top: 10px;">계속 진행하시겠습니까?</p>
</div>`;

    const firstOk = await confirmDialog(firstHtml, '전체 데이터 삭제 - 1단계 확인');
    if (!firstOk) return;

    const keyword = await inputDialog(
        '확인을 위해 정확히 "DELETE" 라고 입력해주세요 (대소문자 구분):',
        '',
        '전체 데이터 삭제 - 2단계 확인'
    );

    if (keyword === null) return;
    if (keyword !== 'DELETE') {
        toast('"DELETE"가 정확히 입력되지 않아 취소되었습니다', 'warning');
        return;
    }

    try {
        const removed = purgeAllData();
        uiState.currentSetId = null;
        toast(`삭제 완료: 세트 ${removed.removedSets}개, 매핑 ${removed.removedCharBindings + removed.removedChatBindings}개`, 'success');
        if (uiState.popupInstance) {
            refreshPopup();
        }
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} 전체 삭제 실패:`, e);
        toast(`삭제 실패: ${e.message}`, 'error');
    }
}

// ===== 팝업 열기 =====

export async function openSlotEditorPopup() {
    try {
        const ctx = getContext();
        if (!ctx?.Popup) {
            toast('SillyTavern Popup API를 찾을 수 없습니다', 'error');
            return;
        }

        // 기본 탭: 적용
        uiState.currentMainTab = 'apply';
        // currentSetId는 유지 (재오픈 시 같은 세트 선택)

        const popup = new ctx.Popup(POPUP_HTML, ctx.POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        });
        uiState.popupInstance = popup;

        const popupPromise = popup.show();

        setTimeout(() => {
            try {
                bindPopupControls();

                // 탭 활성 클래스 동기화
                document.querySelectorAll('.mcp-main-tab-btn').forEach(b => {
                    const isActive = b.getAttribute('data-main-tab') === uiState.currentMainTab;
                    b.classList.toggle('mcp-main-tab-active', isActive);
                });
                const applyPane = document.getElementById('mcp-tab-apply');
                const managePane = document.getElementById('mcp-tab-manage');
                if (applyPane) applyPane.style.display = (uiState.currentMainTab === 'apply') ? '' : 'none';
                if (managePane) managePane.style.display = (uiState.currentMainTab === 'manage') ? '' : 'none';

                refreshPopup();
            } catch (e) {
                console.error(`${LOG_PREFIX_DEV} 팝업 컨트롤 바인딩 실패:`, e);
            }
        }, 50);

        await popupPromise;

        destroySortable();
        uiState.popupInstance = null;
    } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        console.error(`${LOG_PREFIX_DEV} 팝업 오픈 실패:`, msg, e);
        toast('팝업을 열 수 없습니다 (콘솔 확인)', 'error');
    }
}

// ===== 드로어 컨트롤 =====

function bindDrawerControls() {
    const settings = getSettings();

    const master = document.getElementById('mcp-master-enabled');
    if (master) {
        master.checked = !!settings.enabled;
        master.addEventListener('change', () => {
            const s = getSettings();
            s.enabled = master.checked;
            save();
            toast(master.checked ? '확장 활성화' : '확장 비활성화', 'info');
        });
    }

    const openEditorBtn = document.getElementById('mcp-open-editor');
    if (openEditorBtn) {
        openEditorBtn.addEventListener('click', () => openSlotEditorPopup());
    }

    const showTokens = document.getElementById('mcp-show-tokens');
    if (showTokens) {
        showTokens.checked = settings.ui?.showTokenCount !== false;
        showTokens.addEventListener('change', () => {
            const s = getSettings();
            s.ui.showTokenCount = showTokens.checked;
            save();
            if (uiState.popupInstance) {
                refreshSlotList();
                refreshSetMeta();
            }
        });
    }

    const confirmDelete = document.getElementById('mcp-confirm-delete');
    if (confirmDelete) {
        confirmDelete.checked = settings.ui?.confirmBeforeDelete !== false;
        confirmDelete.addEventListener('change', () => {
            const s = getSettings();
            s.ui.confirmBeforeDelete = confirmDelete.checked;
            save();
        });
    }

    const showSlotNotes = document.getElementById('mcp-show-slot-notes');
    if (showSlotNotes) {
        showSlotNotes.checked = settings.ui?.showSlotNotes !== false;
        showSlotNotes.addEventListener('change', () => {
            const s = getSettings();
            s.ui.showSlotNotes = showSlotNotes.checked;
            save();
            if (uiState.popupInstance) refreshSlotList();
        });
    }

    const cleanupBtn = document.getElementById('mcp-cleanup-orphan');
    if (cleanupBtn) {
        cleanupBtn.addEventListener('click', () => showOrphanDialog());
    }

    const purgeBtn = document.getElementById('mcp-purge-all');
    if (purgeBtn) {
        purgeBtn.addEventListener('click', () => showPurgeAllDialog());
    }
}

// ===== 마법봉 메뉴 =====

const MAX_WAND_RETRIES = 15;
const WAND_RETRY_INTERVAL = 1000;

function addWandMenuButton(retryCount = 0) {
    if (document.getElementById('mcp-wand-menu-item')) return;

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        if (retryCount < MAX_WAND_RETRIES) {
            setTimeout(() => addWandMenuButton(retryCount + 1), WAND_RETRY_INTERVAL);
        } else {
            console.warn(`${LOG_PREFIX_DEV} extensionsMenu를 찾을 수 없어 마법봉 메뉴 등록 실패`);
        }
        return;
    }

    const menuItem = document.createElement('div');
    menuItem.id = 'mcp-wand-menu-item';
    menuItem.className = 'list-group-item flex-container flexGap5 interactable';
    menuItem.tabIndex = 0;
    menuItem.setAttribute('role', 'listitem');
    menuItem.innerHTML = `
        <div class="fa-solid fa-sliders extensionsMenuExtensionButton"></div>
        <span>Mini Prompt</span>
    `;
    menuItem.addEventListener('click', async () => {
        try { $('#extensionsMenu').hide(); } catch (e) { /* ignore */ }
        await openSlotEditorPopup();
    });
    extensionsMenu.appendChild(menuItem);
    console.log(`${LOG_PREFIX_DEV} 마법봉 메뉴 등록 완료`);
}

// ===== 메인 갱신 (외부 호출용) =====

export function onContextChanged() {
    if (uiState.popupInstance && document.getElementById('mcp-summary-content')) {
        try {
            refreshPopup();
        } catch (e) {
            console.error(`${LOG_PREFIX_DEV} 컨텍스트 변경 시 갱신 실패:`, e);
        }
    }
}

// ===== 초기화 =====

export async function initUI() {
    try {
        const container = document.getElementById('extensions_settings');
        if (!container) {
            console.warn(`${LOG_PREFIX_DEV} #extensions_settings 컨테이너를 찾을 수 없음`);
            return;
        }

        if (!document.getElementById('mcp-master-enabled')) {
            container.insertAdjacentHTML('beforeend', DRAWER_HTML);
            bindDrawerControls();
        }

        addWandMenuButton();

        console.log(`${LOG_PREFIX_DEV} UI 초기화 완료`);
    } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        console.error(`${LOG_PREFIX_DEV} UI 초기화 오류:`, msg, e);
    }
}
