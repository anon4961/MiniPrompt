/**
 * Mini Prompt - 데이터 저장/로드 (v2: 글로벌 세트 풀 + 바인딩)
 */

import { extension_settings, getContext } from '../../../../extensions.js';
import { saveSettingsDebounced, characters, this_chid } from '../../../../../script.js';
import {
    SETTINGS_KEY,
    DATA_VERSION,
    DEFAULT_SETTINGS,
    LOG_PREFIX_DEV,
    createEmptySet,
    makeChatKey,
    generateId,
} from './constants.js';

/**
 * 그룹 정보를 안전하게 가져오기 (getContext 우회)
 */
function getGroupContext() {
    try {
        const ctx = getContext();
        return {
            selected_group: ctx?.groupId || null,
            groups: ctx?.groups || [],
        };
    } catch (e) {
        return { selected_group: null, groups: [] };
    }
}

/**
 * 설정 초기화 (확장 시작 시 1회 호출)
 */
export function initSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = structuredClone(DEFAULT_SETTINGS);
        saveSettingsDebounced();
        console.log(`${LOG_PREFIX_DEV} 설정 초기화 완료 (v${DATA_VERSION})`);
        return;
    }

    // 누락된 필드 자동 보강
    const settings = extension_settings[SETTINGS_KEY];
    let migrated = false;

    if (!settings.version) {
        settings.version = DATA_VERSION;
        migrated = true;
    }
    if (typeof settings.enabled !== 'boolean') {
        settings.enabled = true;
        migrated = true;
    }
    if (!settings.sets || typeof settings.sets !== 'object' || Array.isArray(settings.sets)) {
        settings.sets = {};
        migrated = true;
    }
    if (!settings.bindings || typeof settings.bindings !== 'object') {
        settings.bindings = { characters: {}, chats: {} };
        migrated = true;
    } else {
        if (!settings.bindings.characters || typeof settings.bindings.characters !== 'object') {
            settings.bindings.characters = {};
            migrated = true;
        }
        if (!settings.bindings.chats || typeof settings.bindings.chats !== 'object') {
            settings.bindings.chats = {};
            migrated = true;
        }
    }
    if (!settings.ui || typeof settings.ui !== 'object') {
        settings.ui = structuredClone(DEFAULT_SETTINGS.ui);
        migrated = true;
    } else {
        for (const key of Object.keys(DEFAULT_SETTINGS.ui)) {
            if (settings.ui[key] === undefined) {
                settings.ui[key] = DEFAULT_SETTINGS.ui[key];
                migrated = true;
            }
        }
    }

    // --- v3: 태그 + 메모 ---
    if (!Array.isArray(settings.tags)) {
        settings.tags = [];
        migrated = true;
    }

    const knownTags = new Set(settings.tags);
    for (const set of Object.values(settings.sets || {})) {
        if (!set || typeof set !== 'object') continue;
        if (!Array.isArray(set.tags)) {
            set.tags = [];
            migrated = true;
        } else {
            // 세트에만 있고 전역 목록에 없는 태그는 전역 목록에 편입 (데이터 유실 방지)
            for (const t of set.tags) {
                if (typeof t === 'string' && t && !knownTags.has(t)) {
                    knownTags.add(t);
                    settings.tags.push(t);
                    migrated = true;
                }
            }
        }
        if (typeof set.note !== 'string') {
            set.note = '';
            migrated = true;
        }
        if (Array.isArray(set.slots)) {
            for (const slot of set.slots) {
                if (!slot || typeof slot !== 'object') continue;
                if (typeof slot.note !== 'string') {
                    slot.note = '';
                    migrated = true;
                }
            }
        }
    }

    if (settings.version !== DATA_VERSION) {
        settings.version = DATA_VERSION;
        migrated = true;
    }

    if (migrated) {
        saveSettingsDebounced();
        console.log(`${LOG_PREFIX_DEV} 설정 마이그레이션 완료 (v${DATA_VERSION})`);
    }
}

/**
 * 전체 설정 객체 반환
 */
export function getSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        initSettings();
    }
    return extension_settings[SETTINGS_KEY];
}

/**
 * 저장 (debounced)
 */
export function save() {
    saveSettingsDebounced();
}

// ===== 컨텍스트 키 헬퍼 =====

/**
 * 현재 캐릭터 키 반환 (avatar 파일명)
 * 그룹 채팅인 경우 'group_<groupId>' 형식
 */
export function getCurrentCharacterKey() {
    const { selected_group } = getGroupContext();
    if (selected_group) {
        return `group_${selected_group}`;
    }
    if (this_chid === undefined || this_chid === null) {
        return null;
    }
    const char = characters?.[this_chid];
    if (!char || !char.avatar) return null;
    return char.avatar;
}

/**
 * 현재 채팅 파일명 반환
 */
export function getCurrentChatFile() {
    const { selected_group, groups } = getGroupContext();
    if (selected_group) {
        const group = groups?.find(g => g.id === selected_group);
        return group?.chat_id || null;
    }
    if (this_chid === undefined || this_chid === null) return null;
    const char = characters?.[this_chid];
    return char?.chat || null;
}

/**
 * 현재 채팅 키 반환
 */
export function getCurrentChatKey() {
    const charKey = getCurrentCharacterKey();
    const chatFile = getCurrentChatFile();
    return makeChatKey(charKey, chatFile);
}

// ===== 세트 풀 CRUD (글로벌) =====

/**
 * 모든 세트 반환 (객체 배열)
 */
export function getAllSets() {
    const settings = getSettings();
    return Object.values(settings.sets || {});
}

/**
 * 세트 ID로 가져오기
 */
export function getSet(setId) {
    if (!setId) return null;
    const settings = getSettings();
    return settings.sets?.[setId] || null;
}

/**
 * 세트 추가
 * @param {string} name
 * @returns {object} 새 세트
 */
export function addSet(name) {
    const settings = getSettings();
    const newSet = createEmptySet(name || '새 세트');
    settings.sets[newSet.id] = newSet;
    save();
    return newSet;
}

/**
 * 기존 세트 객체를 풀에 추가 (import용)
 * 중복 ID인 경우 새 ID 부여
 */
export function addSetObject(setObj) {
    const settings = getSettings();
    if (!setObj || typeof setObj !== 'object') return null;
    if (settings.sets[setObj.id]) {
        // ID 충돌: 새 ID 부여
        setObj = { ...setObj, id: generateId('set') };
    }
    settings.sets[setObj.id] = setObj;
    save();
    return setObj;
}

/**
 * 세트 업데이트
 */
export function updateSet(setId, updates) {
    const set = getSet(setId);
    if (!set) return false;
    Object.assign(set, updates, { updatedAt: Date.now() });
    save();
    return true;
}

/**
 * 세트 삭제 (글로벌 풀에서 제거 + 모든 binding에서도 제거)
 */
export function deleteSet(setId) {
    const settings = getSettings();
    if (!settings.sets[setId]) return false;

    delete settings.sets[setId];

    // 모든 캐릭터 binding에서 제거
    for (const charKey of Object.keys(settings.bindings.characters || {})) {
        const arr = settings.bindings.characters[charKey];
        if (Array.isArray(arr)) {
            const idx = arr.indexOf(setId);
            if (idx !== -1) arr.splice(idx, 1);
            if (arr.length === 0) delete settings.bindings.characters[charKey];
        }
    }
    // 모든 채팅 binding에서 제거
    for (const chatKey of Object.keys(settings.bindings.chats || {})) {
        const arr = settings.bindings.chats[chatKey];
        if (Array.isArray(arr)) {
            const idx = arr.indexOf(setId);
            if (idx !== -1) arr.splice(idx, 1);
            if (arr.length === 0) delete settings.bindings.chats[chatKey];
        }
    }

    save();
    return true;
}

// ===== 태그 CRUD (전역) =====

/**
 * 전역 태그 목록 반환 (순서 유지)
 */
export function getAllTags() {
    const settings = getSettings();
    return Array.isArray(settings.tags) ? [...settings.tags] : [];
}

/**
 * 전역 태그 추가
 * @returns {boolean} 실제로 추가되었으면 true (중복이면 false)
 */
export function addTag(name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const settings = getSettings();
    if (!Array.isArray(settings.tags)) settings.tags = [];
    if (settings.tags.includes(clean)) return false;
    settings.tags.push(clean);
    save();
    return true;
}

/**
 * 전역 태그 이름 변경 (모든 세트의 해당 태그도 함께 변경)
 */
export function renameTag(oldName, newName) {
    const clean = String(newName || '').trim();
    if (!oldName || !clean || oldName === clean) return false;
    const settings = getSettings();
    if (!Array.isArray(settings.tags)) return false;
    const idx = settings.tags.indexOf(oldName);
    if (idx === -1) return false;
    if (settings.tags.includes(clean)) return false;  // 이름 충돌

    settings.tags[idx] = clean;
    for (const set of Object.values(settings.sets || {})) {
        if (!Array.isArray(set.tags)) continue;
        const i = set.tags.indexOf(oldName);
        if (i !== -1) {
            set.tags[i] = clean;
            set.updatedAt = Date.now();
        }
    }
    save();
    return true;
}

/**
 * 전역 태그 삭제 (세트는 삭제되지 않고 해당 태그만 제거됨)
 * @returns {number} 태그가 제거된 세트 수
 */
export function deleteTag(name) {
    if (!name) return 0;
    const settings = getSettings();
    if (!Array.isArray(settings.tags)) return 0;
    const idx = settings.tags.indexOf(name);
    if (idx !== -1) settings.tags.splice(idx, 1);

    let affected = 0;
    for (const set of Object.values(settings.sets || {})) {
        if (!Array.isArray(set.tags)) continue;
        const i = set.tags.indexOf(name);
        if (i !== -1) {
            set.tags.splice(i, 1);
            set.updatedAt = Date.now();
            affected++;
        }
    }
    save();
    return affected;
}

/**
 * 특정 태그를 쓰는 세트 수
 */
export function getTagUsageCount(name) {
    const settings = getSettings();
    let count = 0;
    for (const set of Object.values(settings.sets || {})) {
        if (Array.isArray(set.tags) && set.tags.includes(name)) count++;
    }
    return count;
}

/**
 * 세트에 태그 하나 토글
 */
export function toggleSetTag(setId, tag) {
    const set = getSet(setId);
    if (!set) return false;
    const clean = String(tag || '').trim();
    if (!clean) return false;
    if (!Array.isArray(set.tags)) set.tags = [];
    const i = set.tags.indexOf(clean);
    if (i === -1) {
        set.tags.push(clean);
        addTag(clean);
    } else {
        set.tags.splice(i, 1);
    }
    set.updatedAt = Date.now();
    save();
    return true;
}

// ===== 슬롯 CRUD =====

export function addSlot(setId, slot) {
    const set = getSet(setId);
    if (!set) return false;
    if (!Array.isArray(set.slots)) set.slots = [];
    set.slots.push(slot);
    set.updatedAt = Date.now();
    save();
    return true;
}

export function updateSlot(setId, slotId, updates) {
    const set = getSet(setId);
    if (!set || !Array.isArray(set.slots)) return false;
    const slot = set.slots.find(s => s.id === slotId);
    if (!slot) return false;
    Object.assign(slot, updates);
    set.updatedAt = Date.now();
    save();
    return true;
}

export function deleteSlot(setId, slotId) {
    const set = getSet(setId);
    if (!set || !Array.isArray(set.slots)) return false;
    const idx = set.slots.findIndex(s => s.id === slotId);
    if (idx === -1) return false;
    set.slots.splice(idx, 1);
    set.updatedAt = Date.now();
    save();
    return true;
}

export function reorderSlots(setId, newSlotIds) {
    const set = getSet(setId);
    if (!set || !Array.isArray(set.slots)) return false;

    const idMap = new Map(set.slots.map(s => [s.id, s]));
    const reordered = [];
    for (const id of newSlotIds) {
        if (idMap.has(id)) {
            reordered.push(idMap.get(id));
            idMap.delete(id);
        }
    }
    for (const remaining of idMap.values()) {
        reordered.push(remaining);
    }

    set.slots = reordered;
    set.updatedAt = Date.now();
    save();
    return true;
}

// ===== Binding (적용 매핑) =====

/**
 * 특정 컨텍스트에 적용된 세트 ID 배열 반환
 * @param {'character'|'chat'} scope
 * @param {string} targetKey
 * @returns {string[]} setId 배열
 */
export function getBindings(scope, targetKey) {
    if (!targetKey) return [];
    const settings = getSettings();
    const bindings = scope === 'character'
        ? settings.bindings.characters
        : settings.bindings.chats;
    return Array.isArray(bindings[targetKey]) ? [...bindings[targetKey]] : [];
}

/**
 * 세트를 컨텍스트에 적용 (binding 추가)
 */
export function bindSet(scope, targetKey, setId) {
    if (!targetKey || !setId) return false;
    const settings = getSettings();
    const set = settings.sets[setId];
    if (!set) return false;

    const bindings = scope === 'character'
        ? settings.bindings.characters
        : settings.bindings.chats;
    if (!Array.isArray(bindings[targetKey])) {
        bindings[targetKey] = [];
    }
    if (!bindings[targetKey].includes(setId)) {
        bindings[targetKey].push(setId);
        save();
    }
    return true;
}

/**
 * 세트 적용 해제 (binding 제거)
 */
export function unbindSet(scope, targetKey, setId) {
    if (!targetKey || !setId) return false;
    const settings = getSettings();
    const bindings = scope === 'character'
        ? settings.bindings.characters
        : settings.bindings.chats;
    const arr = bindings[targetKey];
    if (!Array.isArray(arr)) return false;
    const idx = arr.indexOf(setId);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    if (arr.length === 0) delete bindings[targetKey];
    save();
    return true;
}

/**
 * 세트가 어느 컨텍스트에 적용되어 있는지 조회 (uses count)
 */
export function getSetUsage(setId) {
    const settings = getSettings();
    let charCount = 0;
    let chatCount = 0;

    for (const arr of Object.values(settings.bindings.characters || {})) {
        if (Array.isArray(arr) && arr.includes(setId)) charCount++;
    }
    for (const arr of Object.values(settings.bindings.chats || {})) {
        if (Array.isArray(arr) && arr.includes(setId)) chatCount++;
    }
    return { charCount, chatCount, total: charCount + chatCount };
}

// ===== 채팅방 이름 변경 마이그레이션 =====

/**
 * 채팅방 이름 변경 시 binding 키 이전
 */
export function migrateChatKey(charKey, oldChatFile, newChatFile) {
    if (!charKey || !oldChatFile || !newChatFile) return false;
    if (oldChatFile === newChatFile) return false;

    const oldKey = makeChatKey(charKey, oldChatFile);
    const newKey = makeChatKey(charKey, newChatFile);
    const settings = getSettings();

    if (!settings.bindings.chats[oldKey]) return false;
    if (settings.bindings.chats[newKey]) {
        console.warn(`${LOG_PREFIX_DEV} 채팅방 이름 변경 마이그레이션 충돌: ${newKey}에 이미 binding 존재`);
        return false;
    }

    settings.bindings.chats[newKey] = settings.bindings.chats[oldKey];
    delete settings.bindings.chats[oldKey];
    save();
    console.log(`${LOG_PREFIX_DEV} 채팅방 binding 이전: ${oldKey} → ${newKey}`);
    return true;
}

// ===== 고아 binding 감지 =====

/**
 * 더 이상 존재하지 않는 캐릭터·채팅방의 binding 검색
 * 세트 자체는 안전 (다른 곳에서 쓸 수 있음)
 */
export function findOrphanedBindings() {
    const settings = getSettings();
    const result = { orphanedCharacters: [], orphanedChats: [] };

    if (!characters || characters.length === 0) {
        return result;
    }

    const { groups } = getGroupContext();
    const validAvatars = new Set(characters.map(c => c.avatar));
    const validGroupKeys = new Set((groups || []).map(g => `group_${g.id}`));

    for (const charKey of Object.keys(settings.bindings.characters || {})) {
        if (!validAvatars.has(charKey) && !validGroupKeys.has(charKey)) {
            result.orphanedCharacters.push(charKey);
        }
    }

    for (const chatKey of Object.keys(settings.bindings.chats || {})) {
        const idx = chatKey.indexOf('__');
        if (idx === -1) {
            result.orphanedChats.push(chatKey);
            continue;
        }
        const charKey = chatKey.substring(0, idx);
        if (!validAvatars.has(charKey) && !validGroupKeys.has(charKey)) {
            result.orphanedChats.push(chatKey);
        }
    }

    return result;
}

/**
 * 고아 binding 삭제 (사용자 확인 후 호출)
 */
export function removeOrphanedBindings(charKeys = [], chatKeys = []) {
    const settings = getSettings();
    let removedChars = 0;
    let removedChats = 0;

    for (const k of charKeys) {
        if (settings.bindings.characters[k]) {
            delete settings.bindings.characters[k];
            removedChars++;
        }
    }
    for (const k of chatKeys) {
        if (settings.bindings.chats[k]) {
            delete settings.bindings.chats[k];
            removedChats++;
        }
    }

    if (removedChars > 0 || removedChats > 0) {
        save();
    }
    return { removedChars, removedChats };
}

/**
 * 전체 데이터 삭제 (세트 + binding)
 */
export function purgeAllData() {
    const settings = getSettings();
    const removedSets = Object.keys(settings.sets || {}).length;
    const removedCharBindings = Object.keys(settings.bindings.characters || {}).length;
    const removedChatBindings = Object.keys(settings.bindings.chats || {}).length;
    settings.sets = {};
    settings.bindings = { characters: {}, chats: {} };
    save();
    console.log(`${LOG_PREFIX_DEV} 전체 데이터 삭제: 세트 ${removedSets}개, 캐릭터 binding ${removedCharBindings}개, 채팅 binding ${removedChatBindings}개`);
    return { removedSets, removedCharBindings, removedChatBindings };
}

// ===== 현재 컨텍스트 통합 요약 =====

/**
 * 현재 채팅방에 적용 중인 모든 세트 통합 정보
 * 중복 세트(캐릭/채팅 양쪽 적용)는 양쪽 모두 표시하되, 합계는 중복 제거된 실제 주입 슬롯 수
 */
export function getActiveSetsSummary() {
    const settings = getSettings();
    const charKey = getCurrentCharacterKey();
    const chatKey = getCurrentChatKey();
    const result = {
        masterEnabled: !!settings.enabled,
        characterKey: charKey,
        chatKey: chatKey,
        characterSets: [],
        chatSets: [],
        totalActiveSlots: 0,
        duplicateSetIds: new Set(),  // 캐릭/채팅 양쪽에 동시 적용된 세트
    };

    const charSetIds = charKey ? getBindings('character', charKey) : [];
    const chatSetIds = chatKey ? getBindings('chat', chatKey) : [];
    const charIdSet = new Set(charSetIds);

    // 중복 감지
    for (const id of chatSetIds) {
        if (charIdSet.has(id)) result.duplicateSetIds.add(id);
    }

    // 실제 주입 슬롯 수 계산 (중복 세트는 한 번만)
    const countedSetIds = new Set();
    const countSlots = (setId) => {
        if (countedSetIds.has(setId)) return;
        countedSetIds.add(setId);
        const s = settings.sets[setId];
        if (!s || !Array.isArray(s.slots)) return;
        result.totalActiveSlots += s.slots.filter(sl => sl.enabled).length;
    };

    if (charKey) {
        for (const id of charSetIds) {
            const s = settings.sets[id];
            if (!s) continue;
            const activeSlotCount = (s.slots || []).filter(sl => sl.enabled).length;
            result.characterSets.push({
                id: s.id,
                name: s.name,
                totalSlots: (s.slots || []).length,
                activeSlots: activeSlotCount,
                isDuplicate: result.duplicateSetIds.has(s.id),
            });
            countSlots(id);
        }
    }

    if (chatKey) {
        for (const id of chatSetIds) {
            const s = settings.sets[id];
            if (!s) continue;
            const activeSlotCount = (s.slots || []).filter(sl => sl.enabled).length;
            result.chatSets.push({
                id: s.id,
                name: s.name,
                totalSlots: (s.slots || []).length,
                activeSlots: activeSlotCount,
                isDuplicate: result.duplicateSetIds.has(s.id),
            });
            countSlots(id);
        }
    }

    return result;
}
