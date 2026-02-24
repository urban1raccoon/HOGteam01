import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SUPPORTED_LANGUAGES, useI18n } from '../i18n';

export default function LanguageSelector({ compact = false }) {
  const { lang, setLang } = useI18n();

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {SUPPORTED_LANGUAGES.map((option, index) => {
        const active = option.code === lang;
        const last = index === SUPPORTED_LANGUAGES.length - 1;
        return (
          <Pressable
            key={option.code}
            onPress={() => setLang(option.code)}
            style={({ pressed }) => [
              styles.button,
              last && styles.buttonLast,
              active && styles.buttonActive,
              pressed && styles.buttonPressed,
              compact && styles.buttonCompact,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4c1d95',
    backgroundColor: '#1a1034',
    overflow: 'hidden',
  },
  wrapCompact: {
    borderRadius: 10,
  },
  button: {
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(196, 181, 253, 0.18)',
  },
  buttonLast: {
    borderRightWidth: 0,
  },
  buttonCompact: {
    minHeight: 30,
    paddingHorizontal: 9,
  },
  buttonActive: {
    backgroundColor: '#7c3aed',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  text: {
    color: '#ddd6fe',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  textActive: {
    color: '#f5f3ff',
  },
});
