/**
 * Mini Prompt - Export / Import (v2: 글로벌 풀)
 */

import {
    EXPORT_TYPE,
    DATA_VERSION,
    LOG_PREFIX_DEV,
    generateId,
} from './constants.js';
import {
    getSet,
    getAllSets,
    addSetObject,
    bindSet,
    save,
    getSettings,
} from './storage.js';

/**
 * 슬롯 세트를 export 객체로 변환
 */
function setToExportFormat(set) {
    return {
        type: EXPORT_TYPE,
        version: DATA_VERSION,
        exportDate: new Date().toISOString(),
        name: set.name,
        tags: Array.isArray(set.tags) ? [...set.tags] : [],
        note: set.note || '',
        prompts: (set.slots || []).map(slot => ({
            id: slot.id,
            name: slot.label,
            enabled: slot.enabled,
            content: slot.content,
            note: slot.note || '',
            role: slot.role,
            injection_position: slot.position === 'in_chat' ? 1 : 0,
            injection_depth: slot.depth,
            injection_order: slot.order,
            position_raw: slot.position,
        })),
    };
}

/**
 * Export 객체를 세트 구조로 변환
 */
function importFormatToSet(data) {
    if (!data || data.type !== EXPORT_TYPE) {
        throw new Error(`잘못된 파일 형식입니다 (type: ${data?.type})`);
    }
    if (!Array.isArray(data.prompts)) {
        throw new Error('prompts 배열이 없습니다');
    }

    const slots = data.prompts.map(p => ({
        id: generateId('slot'),
        label: p.name || '이름 없음',
        enabled: p.enabled !== false,
        content: p.content || '',
        note: typeof p.note === 'string' ? p.note : '',
        role: ['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system',
        position: p.position_raw
            || (p.injection_position === 1 ? 'in_chat' : 'before_main'),
        depth: typeof p.injection_depth === 'number' ? p.injection_depth : 0,
        order: typeof p.injection_order === 'number' ? p.injection_order : 100,
    }));

    // 파일에 태그가 있으면 메모 끝에 참고로만 남기고, 태그 자체는 붙이지 않음
    // (남의 태그 체계가 내 목록에 멋대로 생기는 것을 방지 — 필요하면 사용자가 직접 지정)
    const importedTags = Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string' && t) : [];
    let note = typeof data.note === 'string' ? data.note : '';
    if (importedTags.length > 0) {
        const hint = `[불러온 파일의 태그: ${importedTags.join(', ')}]`;
        note = note ? `${note}\n${hint}` : hint;
    }

    return {
        id: generateId('set'),
        name: data.name || 'Imported Set',
        tags: [],
        note: note,
        slots: slots,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/**
 * 단일 세트 export → JSON 문자열
 */
export function exportSet(setId) {
    const set = getSet(setId);
    if (!set) return null;
    const exportData = setToExportFormat(set);
    return JSON.stringify(exportData, null, 2);
}

/**
 * 파일 다운로드 트리거
 */
export function downloadAsFile(filename, jsonString) {
    try {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        return true;
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} 파일 다운로드 실패:`, e);
        return false;
    }
}

/**
 * 파일명 생성
 */
export function makeExportFilename(setName) {
    const safe = String(setName || 'set').replace(/[^a-zA-Z0-9가-힣\-_ ]/g, '_').trim();
    const date = new Date().toISOString().slice(0, 10);
    return `MiniCustomPrompt_${safe}_${date}.json`;
}

/**
 * JSON 파싱 + 검증
 */
export function parseImportJson(jsonString) {
    let data;
    try {
        data = JSON.parse(jsonString);
    } catch (e) {
        return { valid: false, error: 'JSON 파싱 실패: ' + e.message };
    }
    if (!data || typeof data !== 'object') {
        return { valid: false, error: '올바른 객체가 아닙니다' };
    }
    if (data.type !== EXPORT_TYPE) {
        return { valid: false, error: `Mini Prompt 파일이 아닙니다 (type: ${data.type || '없음'})` };
    }
    if (!Array.isArray(data.prompts)) {
        return { valid: false, error: 'prompts 배열이 없습니다' };
    }
    return { valid: true, data };
}

/**
 * 이름 충돌 검사 (글로벌 풀 기준)
 */
export function checkImportConflict(parsedData) {
    if (!parsedData) return { hasConflict: false };
    const allSets = getAllSets();
    const conflictSet = allSets.find(s => s.name === parsedData.name);
    return {
        hasConflict: !!conflictSet,
        conflictSetName: conflictSet?.name || null,
        importSetName: parsedData.name,
    };
}

/**
 * Import 실행
 * @param {object} parsedData
 * @param {string} conflictMode - 'append' | 'overwrite' | 'rename'
 * @param {object} autoApply - { scope: 'character'|'chat', targetKey: string } | null
 * @returns {{success: boolean, set?: object, error?: string}}
 */
export function importSet(parsedData, conflictMode = 'rename', autoApply = null) {
    try {
        const newSet = importFormatToSet(parsedData);
        const settings = getSettings();
        const existingSets = Object.values(settings.sets || {});
        const existingByName = existingSets.find(s => s.name === newSet.name);

        if (existingByName) {
            if (conflictMode === 'overwrite') {
                // 기존 세트 ID는 유지하고 내용만 덮어쓰기 (binding 보존)
                newSet.id = existingByName.id;
                newSet.createdAt = existingByName.createdAt || Date.now();
                // 기존에 지정해둔 태그는 유지 (덮어쓰기로 분류가 사라지지 않도록)
                newSet.tags = Array.isArray(existingByName.tags) ? [...existingByName.tags] : [];
                settings.sets[existingByName.id] = newSet;
                save();
            } else if (conflictMode === 'append') {
                addSetObject(newSet);
            } else {
                // rename
                let counter = 2;
                let candidate = `${newSet.name} (${counter})`;
                while (existingSets.some(s => s.name === candidate)) {
                    counter++;
                    candidate = `${newSet.name} (${counter})`;
                }
                newSet.name = candidate;
                addSetObject(newSet);
            }
        } else {
            addSetObject(newSet);
        }

        // 자동 적용 옵션
        if (autoApply && autoApply.scope && autoApply.targetKey) {
            bindSet(autoApply.scope, autoApply.targetKey, newSet.id);
        }

        return { success: true, set: newSet };
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} Import 실패:`, e);
        return { success: false, error: e.message };
    }
}
