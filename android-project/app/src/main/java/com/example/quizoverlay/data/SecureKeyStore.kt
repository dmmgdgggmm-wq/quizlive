package com.example.quizoverlay.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureKeyStore(context: Context) {

    companion object {
        const val PREFS_FILE_NAME = "quiz_secure_api_keys_prefs"
        private const val KEY_RAW_API_KEYS = "encrypted_api_keys_multiline"
        const val MAX_KEYS = 5

        fun parseKeys(rawText: String): List<String> {
            return rawText
                .lineSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
                .take(MAX_KEYS)
                .toList()
        }

        fun maskKeyTail4(key: String): String {
            val trimmed = key.trim()
            if (trimmed.isEmpty()) return "...????"
            val tail = if (trimmed.length <= 4) trimmed else trimmed.takeLast(4)
            return "...$tail"
        }
    }

    private val encryptedPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveApiKeysFromText(rawText: String): List<String> {
        val normalizedList = parseKeys(rawText)
        encryptedPrefs.edit()
            .putString(KEY_RAW_API_KEYS, normalizedList.joinToString("\n"))
            .apply()
        return normalizedList
    }

    fun getApiKeys(): List<String> {
        val stored = encryptedPrefs.getString(KEY_RAW_API_KEYS, "") ?: ""
        return parseKeys(stored)
    }

    fun clearKeys() {
        encryptedPrefs.edit().remove(KEY_RAW_API_KEYS).apply()
    }
}
