/**
 * Mini Prompt (MiniCustomPrompt) v1.0.0
 * 캐릭터/채팅방별 다중 슬롯 프롬프트 주입 확장
 *
 * 진입점
 */

import { eventSource, event_types } from '../../../../script.js';
import { LOG_PREFIX, LOG_PREFIX_DEV } from './src/constants.js';
import { initSettings } from './src/storage.js';
import { startInjection } from './src/injection.js';
import { setupEventHooks } from './src/events.js';
import { initUI, onContextChanged } from './src/ui.js';

(async function main() {
    try {
        // SillyTavern 코어가 준비되었는지 확인
        if (typeof eventSource === 'undefined' || !event_types) {
            console.error(`${LOG_PREFIX_DEV} SillyTavern 코어 모듈을 가져올 수 없습니다`);
            return;
        }

        // 1. 설정 초기화 (extension_settings 사용)
        initSettings();

        // 2. 주입 엔진 시작
        startInjection();

        // 3. 이벤트 후킹 (채팅 변경 감지 등)
        setupEventHooks();

        // 4. UI 초기화 (드로어 + 마법봉 메뉴 등록)
        const tryInitUI = async () => {
            try {
                if (!document.getElementById('mcp-master-enabled')) {
                    await initUI();
                }
            } catch (e) {
                const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
                console.error(`${LOG_PREFIX_DEV} UI 초기화 실패:`, msg, e);
            }
        };

        if (event_types.APP_READY) {
            eventSource.on(event_types.APP_READY, tryInitUI);
        }

        // 5. 채팅 변경 시 (열려있는 팝업이 있으면) 갱신
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                try {
                    onContextChanged();
                } catch (e) {
                    console.error(`${LOG_PREFIX_DEV} 컨텍스트 변경 처리 실패:`, e);
                }
            });
        }

        // 폴백: APP_READY가 이미 발생했을 가능성 대비
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(tryInitUI, 2000);
        } else {
            window.addEventListener('DOMContentLoaded', () => {
                setTimeout(tryInitUI, 2000);
            });
        }

        console.log(`${LOG_PREFIX} 로드 완료 v1.0.0`);
    } catch (e) {
        const errMsg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        console.error(`${LOG_PREFIX_DEV} 초기화 실패:`, errMsg, e);
    }
})();
