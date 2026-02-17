import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export const SUPPORTED_LANGUAGES = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
  { code: 'kk', label: 'KZ' },
];

const translations = {
  ru: {
    'app.title': 'HOG MAPS',
    'common.request_failed': 'Ошибка запроса',
    'common.user': 'пользователь',
    'common.unknown': 'неизвестно',

    'auth.skip_auth': 'Пропустить вход',
    'auth.create_account': 'Создать аккаунт',
    'auth.sign_in': 'Войти',
    'auth.subtitle': '',
    'auth.nickname': 'Никнейм',
    'auth.email': 'Почта',
    'auth.password': 'Пароль',
    'auth.confirm_password': 'Повтор пароля',
    'auth.login': 'Логин',
    'auth.placeholder.nickname': 'ваше имя',
    'auth.placeholder.email': 'mail@example.com',
    'auth.placeholder.password': 'Минимум 8 символов',
    'auth.placeholder.confirm_password': 'Повторите пароль',
    'auth.placeholder.login': 'никнейм или почта',
    'auth.placeholder.password_login': 'Ваш пароль',
    'auth.passwords_do_not_match': 'Пароли не совпадают',
    'auth.guest_mode_enabled':
      'Гостевой режим включён. Эндпоинты с авторизацией могут быть недоступны.',
    'auth.user_created': 'Пользователь {username} создан. Войдите в аккаунт.',
    'auth.token_missing': 'Токен не вернулся с бэка',
    'auth.welcome': 'Привет, {username}!',
    'auth.please_wait': 'Подождите...',
    'auth.sign_up_button': 'Зарегистрироваться',
    'auth.sign_in_button': 'Войти',
    'auth.already_have_account': 'Уже есть аккаунт? ',
    'auth.no_account_yet': 'Нет аккаунта? ',
    'auth.create_one_link': 'Создать',

    'map.control_center': 'Центр управления',
    'map.refresh_changes': 'Обновить',
    'map.logout': 'Выйти',
    'map.dgis_key': 'Ключ 2GIS',
    'map.active': 'активен',
    'map.missing': 'нет',
    'map.congestion': 'Загруженность',
    'map.hide_graph': 'Скрыть график',
    'map.show_graph': 'Показать график',
    'map.start_label': 'Старт',
    'map.destination_label': 'Финиш',
    'map.tap_map_a': 'тапни по карте (A)',
    'map.tap_map_b': 'тапни по карте (B)',
    'map.destination_set': 'задан',
    'map.manual': 'вручную',
    'map.use_my_location': 'Моё место',
    'map.reset_ab': 'Сбросить A/B',
    'map.route_info': 'Маршрут: {km} км · {min} мин',
    'map.theme.dark': 'Тёмная карта',
    'map.theme.light': 'Светлая карта',
    'map.legend_green': 'Зелёный: свободно',
    'map.legend_yellow': 'Жёлтый: средняя загрузка',
    'map.legend_red': 'Красный: пробка',
    'map.section.change_graph': 'График изменений',
    'map.metric.traffic': 'Трафик',
    'map.metric.ecology': 'Экология',
    'map.metric.social': 'Соц.',
    'map.flow': 'Поток',
    'map.vehicles_per_hour': 'авто/ч',
    'map.detour': 'Объезд',
    'map.system_status': 'Статус системы',
    'map.point.me_a': 'Я (A)',
    'map.point.start_a': 'Старт (A)',
    'map.point.destination_b': 'Финиш (B)',

    'map.status.waiting_transport': 'Ожидаю обновление транспорта',
    'map.status.change_graph_updated': 'Данные обновлены',
    'map.status.transport_update_failed': 'Не удалось обновить данные транспорта',
    'map.status.tap_to_set_a': 'Тапни по карте, чтобы поставить старт (A)',
    'map.status.start_set_tap_b': 'Старт (A) задан. Тапни финиш (B) на карте.',
    'map.status.gps_a_set_tap_b': 'GPS-старт (A) задан. Тапни финиш (B) на карте.',
    'map.status.location_denied':
      'Доступ к геолокации запрещён. Тапни по карте, чтобы поставить старт (A).',
    'map.status.location_read_failed':
      'Не удалось определить геолокацию. Тапни по карте, чтобы поставить старт (A).',
    'map.status.location_lookup_failed':
      'Ошибка геолокации. Тапни по карте, чтобы поставить старт (A).',
    'map.status.route_ready': 'Маршрут готов',
    'map.status.route_ready_summary': 'Маршрут готов: {summary}',
    'map.status.route_build_failed': 'Не удалось построить маршрут',

    'ai.agent': 'AI Агент',
    'ai.welcome':
      'Я AI-агент цифрового двойника. Спроси, например: "Как изменится трафик в ближайшие часы?"',
    'ai.placeholder': 'Например: что изменится в трафике при перекрытии моста?',
    'ai.thinking': 'Думаю...',
    'ai.send': 'Отправить',
    'ai.close': 'Закрыть',

    'ai.fallback.bridge':
      'Прогноз: поток {flow} авто/ч, рост на объездах около {detour}%. Риски: локальные заторы и задержка доставок. Действия: реверсивное движение, ручная настройка светофоров, ограничение грузовиков в пик.',
    'ai.fallback.traffic':
      'Прогноз: текущая транспортная нагрузка близка к {moving}%. Риски: рост времени в пути на перегруженных узлах. Действия: перераспределить рейсы вне пика, увеличить приоритет ОТ, корректировать циклы светофоров.',
    'ai.fallback.ecology':
      'Прогноз: индекс экологии около {ecology}. Риски: локальное ухудшение качества воздуха в загруженных районах. Действия: ограничить транзит через жилые кварталы и перераспределить потоки.',
    'ai.fallback.default':
      'Могу оценить изменения трафика, экологии и логистики по текущим данным. Уточни объект/район и временной горизонт.',

    'map3d.traffic_ready': 'Слой трафика 2GIS включён (зелёный/жёлтый/красный).',
    'map3d.traffic_score': 'Оценка трафика 2GIS: {score}/10.',
    'map3d.fallback_ready': 'Включена запасная карта (MapLibre).',
  },
  en: {
    'app.title': 'HOG MAPS',
    'common.request_failed': 'Request failed',
    'common.user': 'user',
    'common.unknown': 'unknown',

    'auth.skip_auth': 'Skip auth',
    'auth.create_account': 'Create account',
    'auth.sign_in': 'Sign in',
    'auth.subtitle': '',
    'auth.nickname': 'Nickname',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.confirm_password': 'Confirm password',
    'auth.login': 'Login',
    'auth.placeholder.nickname': 'your name',
    'auth.placeholder.email': 'yourmail@example.com',
    'auth.placeholder.password': 'At least 8 characters',
    'auth.placeholder.confirm_password': 'Repeat password',
    'auth.placeholder.login': 'username or email',
    'auth.placeholder.password_login': 'Your password',
    'auth.passwords_do_not_match': 'Passwords do not match',
    'auth.guest_mode_enabled': 'Guest mode enabled. Auth-only endpoints may be unavailable.',
    'auth.user_created': 'User {username} created. Please sign in.',
    'auth.token_missing': 'Token was not returned by backend',
    'auth.welcome': 'Welcome, {username}',
    'auth.please_wait': 'Please wait...',
    'auth.sign_up_button': 'Sign up',
    'auth.sign_in_button': 'Sign in',
    'auth.already_have_account': 'Already have an account? ',
    'auth.no_account_yet': 'No account yet? ',
    'auth.create_one_link': 'Create one',

    'map.control_center': 'Control center',
    'map.refresh_changes': 'Refresh changes',
    'map.logout': 'Logout',
    'map.dgis_key': '2GIS key',
    'map.active': 'active',
    'map.missing': 'missing',
    'map.congestion': 'Congestion',
    'map.hide_graph': 'Hide graph',
    'map.show_graph': 'Show graph',
    'map.start_label': 'Start',
    'map.destination_label': 'Destination',
    'map.tap_map_a': 'tap map (A)',
    'map.tap_map_b': 'tap map (B)',
    'map.destination_set': 'set',
    'map.manual': 'manual',
    'map.use_my_location': 'Use my location',
    'map.reset_ab': 'Reset A/B',
    'map.route_info': 'Route: {km} km · {min} min',
    'map.theme.dark': 'Dark map',
    'map.theme.light': 'Light map',
    'map.legend_green': 'Green: free',
    'map.legend_yellow': 'Yellow: medium load',
    'map.legend_red': 'Red: traffic jam',
    'map.section.change_graph': 'Change graph',
    'map.metric.traffic': 'Traffic',
    'map.metric.ecology': 'Ecology',
    'map.metric.social': 'Social',
    'map.flow': 'Flow',
    'map.vehicles_per_hour': 'veh/h',
    'map.detour': 'Detour',
    'map.system_status': 'System status',
    'map.point.me_a': 'Me (A)',
    'map.point.start_a': 'Start (A)',
    'map.point.destination_b': 'Destination (B)',

    'map.status.waiting_transport': 'Waiting for transport update',
    'map.status.change_graph_updated': 'Change graph updated',
    'map.status.transport_update_failed': 'Transport update failed',
    'map.status.tap_to_set_a': 'Tap map to set start point (A)',
    'map.status.start_set_tap_b': 'Start point (A) is set. Tap destination (B) on map.',
    'map.status.gps_a_set_tap_b': 'GPS start point (A) is set. Tap destination (B) on map.',
    'map.status.location_denied': 'Location permission denied. Tap map to set start point (A).',
    'map.status.location_read_failed': 'Failed to read GPS position. Tap map to set start point (A).',
    'map.status.location_lookup_failed': 'Location lookup failed. Tap map to set start point (A).',
    'map.status.route_ready': 'Route ready',
    'map.status.route_ready_summary': 'Route ready: {summary}',
    'map.status.route_build_failed': 'Route build failed',

    'ai.agent': 'AI Agent',
    'ai.welcome':
      "I'm an AI agent of the city's digital twin. Ask, for example: \"How will traffic change in the next hours?\"",
    'ai.placeholder': 'For example: what happens to traffic if the bridge is closed?',
    'ai.thinking': 'Thinking...',
    'ai.send': 'Send',
    'ai.close': 'Close',

    'ai.fallback.bridge':
      'Forecast: flow {flow} veh/h, detours up ~{detour}%. Risks: local jams and delivery delays. Actions: reversible lanes, manual traffic light tuning, restrict trucks at peak.',
    'ai.fallback.traffic':
      'Forecast: current traffic load is about {moving}%. Risks: longer travel times on key junctions. Actions: shift trips off-peak, increase public transport priority, adjust signal cycles.',
    'ai.fallback.ecology':
      'Forecast: ecology index is around {ecology}. Risks: local air quality degradation in busy areas. Actions: restrict transit through residential blocks and rebalance flows.',
    'ai.fallback.default':
      'I can estimate traffic, ecology and logistics changes from current data. Specify the object/area and time horizon.',

    'map3d.traffic_ready': '2GIS traffic layer enabled (green/yellow/red).',
    'map3d.traffic_score': '2GIS traffic score: {score}/10.',
    'map3d.fallback_ready': 'Fallback map active (MapLibre).',
  },
  kk: {
    'app.title': 'HOG MAPS',
    'common.request_failed': 'Сұрау сәтсіз аяқталды',
    'common.user': 'пайдаланушы',
    'common.unknown': 'беймәлім',

    'auth.skip_auth': 'Кіруді өткізу',
    'auth.create_account': 'Тіркелу',
    'auth.sign_in': 'Кіру',
    'auth.subtitle': '',
    'auth.nickname': 'Лақап ат',
    'auth.email': 'Эл. пошта',
    'auth.password': 'Құпиясөз',
    'auth.confirm_password': 'Құпиясөзді растау',
    'auth.login': 'Логин',
    'auth.placeholder.nickname': 'атыңыз',
    'auth.placeholder.email': 'mail@example.com',
    'auth.placeholder.password': 'Кемі 8 таңба',
    'auth.placeholder.confirm_password': 'Қайта енгізіңіз',
    'auth.placeholder.login': 'аты немесе пошта',
    'auth.placeholder.password_login': 'Құпиясөзіңіз',
    'auth.passwords_do_not_match': 'Құпиясөздер сәйкес емес',
    'auth.guest_mode_enabled': 'Қонақ режимі қосылды. Авторизация қажет эндпоинттар қолжетімсіз болуы мүмкін.',
    'auth.user_created': '{username} пайдаланушысы құрылды. Кіріңіз.',
    'auth.token_missing': 'Бэктен токен қайтпады',
    'auth.welcome': 'Қош келдіңіз, {username}',
    'auth.please_wait': 'Күте тұрыңыз...',
    'auth.sign_up_button': 'Тіркелу',
    'auth.sign_in_button': 'Кіру',
    'auth.already_have_account': 'Аккаунт бар ма? ',
    'auth.no_account_yet': 'Аккаунт жоқ па? ',
    'auth.create_one_link': 'Құру',

    'map.control_center': 'Басқару орталығы',
    'map.refresh_changes': 'Жаңарту',
    'map.logout': 'Шығу',
    'map.dgis_key': '2GIS кілті',
    'map.active': 'бар',
    'map.missing': 'жоқ',
    'map.congestion': 'Кептеліс',
    'map.hide_graph': 'Графикті жасыру',
    'map.show_graph': 'Графикті көрсету',
    'map.start_label': 'Бастау',
    'map.destination_label': 'Мақсат',
    'map.tap_map_a': 'картадан түрт (A)',
    'map.tap_map_b': 'картадан түрт (B)',
    'map.destination_set': 'орнатылды',
    'map.manual': 'қолмен',
    'map.use_my_location': 'Менің орным',
    'map.reset_ab': 'A/B тазалау',
    'map.route_info': 'Бағыт: {km} км · {min} мин',
    'map.theme.dark': 'Қараңғы карта',
    'map.theme.light': 'Жарық карта',
    'map.legend_green': 'Жасыл: бос',
    'map.legend_yellow': 'Сары: орташа',
    'map.legend_red': 'Қызыл: кептеліс',
    'map.section.change_graph': 'Өзгеріс графигі',
    'map.metric.traffic': 'Көлік',
    'map.metric.ecology': 'Экология',
    'map.metric.social': 'Әлеумет',
    'map.flow': 'Ағын',
    'map.vehicles_per_hour': 'көлік/сағ',
    'map.detour': 'Айналма',
    'map.system_status': 'Жүйе күйі',
    'map.point.me_a': 'Мен (A)',
    'map.point.start_a': 'Бастау (A)',
    'map.point.destination_b': 'Мақсат (B)',

    'map.status.waiting_transport': 'Көлік жаңарту күтілуде',
    'map.status.change_graph_updated': 'Деректер жаңартылды',
    'map.status.transport_update_failed': 'Көлік дерегін жаңарту сәтсіз',
    'map.status.tap_to_set_a': 'Бастау нүктесін (A) қою үшін картадан түрт',
    'map.status.start_set_tap_b': 'Бастау (A) орнатылды. Мақсат (B) нүктесін картадан түрт.',
    'map.status.gps_a_set_tap_b': 'GPS бастау (A) орнатылды. Мақсат (B) нүктесін картадан түрт.',
    'map.status.location_denied': 'Геолокацияға рұқсат жоқ. Бастау (A) үшін картадан түрт.',
    'map.status.location_read_failed': 'GPS орнын оқу сәтсіз. Бастау (A) үшін картадан түрт.',
    'map.status.location_lookup_failed': 'Геолокация қатесі. Бастау (A) үшін картадан түрт.',
    'map.status.route_ready': 'Бағыт дайын',
    'map.status.route_ready_summary': 'Бағыт дайын: {summary}',
    'map.status.route_build_failed': 'Бағыт құру сәтсіз',

    'ai.agent': 'AI Агент',
    'ai.welcome':
      'Мен қала цифрлық егізінің AI агентімін. Мысалы сұра: "Алдағы сағаттарда трафик қалай өзгереді?"',
    'ai.placeholder': 'Мысалы: көпір жабылса трафик қалай өзгереді?',
    'ai.thinking': 'Ойлануда...',
    'ai.send': 'Жіберу',
    'ai.close': 'Жабу',

    'ai.fallback.bridge':
      'Болжам: ағын {flow} көлік/сағ, айналмада өсім шамамен {detour}%. Тәуекелдер: жергілікті кептеліс және жеткізу кешігуі. Әрекеттер: реверсивті қозғалыс, бағдаршамды қолмен реттеу, шарықтау кезде жүк көліктерін шектеу.',
    'ai.fallback.traffic':
      'Болжам: ағымдағы жүктеме шамамен {moving}%. Тәуекелдер: негізгі тораптарда жол уақыты ұзаруы мүмкін. Әрекеттер: сапарларды пік емес уақытқа ауыстыру, қоғамдық көлікке басымдық беру, циклдерді реттеу.',
    'ai.fallback.ecology':
      'Болжам: экология индексі шамамен {ecology}. Тәуекелдер: жүктемесі жоғары аймақтарда ауа сапасы нашарлауы мүмкін. Әрекеттер: тұрғын аудандар арқылы транзитті шектеу және ағындарды қайта бөлу.',
    'ai.fallback.default':
      'Ағымдағы деректер бойынша трафик, экология және логистика өзгерістерін бағалай аламын. Аудан/нысан және уақытты нақтыла.',

    'map3d.traffic_ready': '2GIS кептеліс қабаты қосылды (жасыл/сары/қызыл).',
    'map3d.traffic_score': '2GIS кептеліс бағасы: {score}/10.',
    'map3d.fallback_ready': 'Қосалқы карта қосылды (MapLibre).',
  },
};

function format(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

const I18nContext = createContext({
  lang: 'ru',
  setLang: () => undefined,
  t: (key) => key,
});

export function I18nProvider({ children, initialLang = 'ru' }) {
  const [lang, setLang] = useState(initialLang);

  const t = useCallback(
    (key, params) => {
      const dict = translations[lang] || translations.ru;
      const fallback = translations.ru;
      const value = dict[key] ?? fallback[key] ?? translations.en[key] ?? key;
      return format(value, params);
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
