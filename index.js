import { eventSource, event_types, getContext, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const extensionName = 'st-replace-tool';
const defaultSettings = {};

// 팝업 HTML
function getPopupHtml() {
    return `
    <div id="replace-tool-popup" class="replace-tool-popup" style="display:none;">
        <div class="replace-tool-overlay"></div>
        <div class="replace-tool-modal">
            <div class="replace-tool-header">
                <span>🔄 텍스트 치환</span>
                <button class="replace-tool-close" title="닫기">✕</button>
            </div>
            <div class="replace-tool-body">
                <div id="replace-tool-rules"></div>
                <div class="replace-tool-actions">
                    <button id="replace-tool-add" class="menu_button">+ 규칙 추가</button>
                    <button id="replace-tool-exec" class="menu_button replace-tool-exec-btn">🚀 치환 실행</button>
                </div>
                <div class="replace-tool-preview-section">
                    <label>미리보기</label>
                    <div id="replace-tool-preview" class="replace-tool-preview"></div>
                </div>
            </div>
        </div>
    </div>`;
}

function getRuleHtml(index) {
    return `
    <div class="replace-tool-rule" data-index="${index}">
        <textarea class="replace-tool-find" placeholder="찾을 텍스트" rows="1"></textarea>
        <textarea class="replace-tool-replace" placeholder="바꿀 텍스트 (비우면 삭제)" rows="1"></textarea>
        <button class="replace-tool-remove menu_button" title="삭제">✕</button>
    </div>`;
}

let currentMessageId = null;

// 메시지 버튼 추가
function addReplaceButtons() {
    document.querySelectorAll('.mes').forEach(mesEl => {
        const extraBlock = mesEl.querySelector('.mes_block .mes_buttons .extraMesButtons');
        if (!extraBlock) return;
        if (extraBlock.querySelector('.replace-tool-btn')) return;

        const btn = document.createElement('div');
        btn.classList.add('replace-tool-btn', 'mes_button', 'fa-solid', 'fa-right-left');
        btn.title = '텍스트 치환';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mesId = mesEl.getAttribute('mesid');
            openPopup(mesId);
        });

        extraBlock.prepend(btn);
    });
}

function openPopup(mesId) {
    currentMessageId = Number(mesId);
    const popup = document.getElementById('replace-tool-popup');
    const rulesContainer = document.getElementById('replace-tool-rules');
    const preview = document.getElementById('replace-tool-preview');

    // 초기화
    rulesContainer.innerHTML = '';
    addRule();

    // 미리보기에 현재 텍스트 표시
    const context = getContext();
    const msg = context.chat[currentMessageId];
    if (msg) {
        preview.textContent = msg.mes;
    }

    popup.style.display = 'flex';
}

function closePopup() {
    const popup = document.getElementById('replace-tool-popup');
    popup.style.display = 'none';
    currentMessageId = null;
}

function addRule() {
    const rulesContainer = document.getElementById('replace-tool-rules');
    const index = rulesContainer.querySelectorAll('.replace-tool-rule').length;
    rulesContainer.insertAdjacentHTML('beforeend', getRuleHtml(index));

    // 입력 시 미리보기 업데이트
    const rule = rulesContainer.lastElementChild;
    rule.querySelector('.replace-tool-find').addEventListener('input', updatePreview);
    rule.querySelector('.replace-tool-replace').addEventListener('input', updatePreview);
    rule.querySelector('.replace-tool-remove').addEventListener('click', (e) => {
        rule.remove();
        updatePreview();
    });
}

function getRules() {
    const rules = [];
    document.querySelectorAll('.replace-tool-rule').forEach(ruleEl => {
        const find = ruleEl.querySelector('.replace-tool-find').value;
        const replace = ruleEl.querySelector('.replace-tool-replace').value;
        if (find) {
            rules.push({ find, replace });
        }
    });
    return rules;
}

function applyRules(text, rules) {
    let result = text;
    for (const rule of rules) {
        // 모든 발생을 치환 (global)
        result = result.split(rule.find).join(rule.replace);
    }
    return result;
}

function updatePreview() {
    const context = getContext();
    const msg = context.chat[currentMessageId];
    if (!msg) return;

    const rules = getRules();
    const result = applyRules(msg.mes, rules);
    const preview = document.getElementById('replace-tool-preview');
    preview.textContent = result;
}

async function executeReplace() {
    const context = getContext();
    const msg = context.chat[currentMessageId];
    if (!msg) return;

    const rules = getRules();
    if (rules.length === 0) {
        toastr.warning('치환 규칙을 입력해주세요.');
        return;
    }

    const newText = applyRules(msg.mes, rules);

    if (newText === msg.mes) {
        toastr.info('변경된 내용이 없습니다.');
        return;
    }

    // 메시지 업데이트
    msg.mes = newText;

    // DOM 업데이트
    const mesEl = document.querySelector(`.mes[mesid="${currentMessageId}"]`);
    if (mesEl) {
        const mesTextEl = mesEl.querySelector('.mes_text');
        if (mesTextEl) {
            mesTextEl.innerHTML = messageFormatting(newText, msg.name, msg.is_system, msg.is_user, currentMessageId);
        }
    }

    // 저장
    await context.saveChat();

    const count = rules.length;
    toastr.success(`${count}개 규칙으로 치환 완료!`);
    closePopup();
}

// messageFormatting 가져오기 시도
function messageFormatting(text, name, isSystem, isUser, messageId) {
    try {
        // SillyTavern의 messageFormatting 함수 사용
        if (typeof window.messageFormatting === 'function') {
            return window.messageFormatting(text, name, isSystem, isUser, messageId);
        }
    } catch (e) {
        // fallback
    }
    // 단순 fallback: 줄바꿈을 <br>로
    return text.replace(/\n/g, '<br>');
}

// 초기화
jQuery(async () => {
    // 팝업 HTML 삽입
    $('body').append(getPopupHtml());

    // 이벤트 바인딩
    $(document).on('click', '.replace-tool-close', closePopup);
    $(document).on('click', '.replace-tool-overlay', closePopup);
    $(document).on('click', '#replace-tool-add', addRule);
    $(document).on('click', '#replace-tool-exec', executeReplace);

    // 메시지 렌더링 시 버튼 추가
    eventSource.on(event_types.MESSAGE_RENDERED, () => {
        addReplaceButtons();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(addReplaceButtons, 300);
    });

    // 초기 로딩
    setTimeout(addReplaceButtons, 1000);

    console.log(`[${extensionName}] loaded`);
});
