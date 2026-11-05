package com.example.quizoverlay.model

object ModelStrengthScorer {

    const val DEFAULT_PREFERRED_MODEL = "gemini-3.8-flash"

    val DEFAULT_MODELS = listOf(
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest"
    )

    private val VERSION_REGEX = Regex("^gemini-(\\d+)(?:\\.(\\d+))?", RegexOption.IGNORE_CASE)
    private val DATED_OR_PREVIEW_REGEX = Regex("(-\\d{2}-\\d{2})|(-\\d{4})|(-\\d{3}$)", RegexOption.IGNORE_CASE)

    private val EXCLUDED_KEYWORDS = listOf(
        "embedding",
        "imagen",
        "veo",
        "tts",
        "aqa",
        "bisheng",
        "learnlm",
        "audio"
    )

    fun normalizeModelName(rawName: String): String {
        return rawName.trim().removePrefix("models/")
    }

    fun isEligibleVisionTextModel(
        rawName: String,
        supportedGenerationMethods: List<String>?
    ): Boolean {
        val clean = normalizeModelName(rawName).lowercase()
        if (!clean.startsWith("gemini-")) return false
        if (supportedGenerationMethods == null || !supportedGenerationMethods.contains("generateContent")) {
            return false
        }
        return EXCLUDED_KEYWORDS.none { clean.contains(it) }
    }

    data class StrengthScore(
        val major: Int,
        val minor: Int,
        val tierRank: Int, // 3 = pro, 2 = flash (kể cả -latest), 1 = flash-lite, 0 = khác
        val stabilityRank: Int, // 1 = bản ổn định, 0 = preview/exp/có ngày phát hành
        val cleanName: String
    ) : Comparable<StrengthScore> {
        override fun compareTo(other: StrengthScore): Int {
            // Sắp xếp giảm dần theo sức mạnh (mạnh nhất đứng đầu)
            if (this.major != other.major) return other.major.compareTo(this.major)
            if (this.minor != other.minor) return other.minor.compareTo(this.minor)
            if (this.tierRank != other.tierRank) return other.tierRank.compareTo(this.tierRank)
            if (this.stabilityRank != other.stabilityRank) return other.stabilityRank.compareTo(this.stabilityRank)
            return this.cleanName.compareTo(other.cleanName)
        }
    }

    fun scoreModelStrength(rawModelName: String): StrengthScore {
        val clean = normalizeModelName(rawModelName).lowercase()
        val match = VERSION_REGEX.find(clean)
        val major = match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
        val minor = match?.groupValues?.getOrNull(2)?.takeIf { it.isNotEmpty() }?.toIntOrNull() ?: 0

        val tierRank = when {
            clean.contains("flash-lite") || clean.contains("lite") -> 1
            clean.contains("pro") -> 3
            clean.contains("flash") -> 2
            else -> 0
        }

        val isPreviewOrDated = clean.contains("preview") ||
            clean.contains("exp") ||
            DATED_OR_PREVIEW_REGEX.containsMatchIn(clean)
        val stabilityRank = if (isPreviewOrDated) 0 else 1

        return StrengthScore(
            major = major,
            minor = minor,
            tierRank = tierRank,
            stabilityRank = stabilityRank,
            cleanName = clean
        )
    }

    fun sortModelsByStrength(models: Collection<String>): List<String> {
        return models
            .map { normalizeModelName(it) }
            .filter { it.isNotBlank() }
            .distinct()
            .sortedWith { a, b -> scoreModelStrength(a).compareTo(scoreModelStrength(b)) }
    }

    fun selectDefaultPreferredModel(sortedModels: List<String>): String {
        if (sortedModels.contains(DEFAULT_PREFERRED_MODEL)) {
            return DEFAULT_PREFERRED_MODEL
        }
        val latestFlash = sortedModels.firstOrNull { name ->
            val lower = name.lowercase()
            lower.contains("flash") && !lower.contains("flash-lite") && !lower.contains("lite")
        }
        if (latestFlash != null) return latestFlash
        return sortedModels.firstOrNull() ?: DEFAULT_PREFERRED_MODEL
    }

    /**
     * Chuỗi model = [model ưu tiên] + tối đa 5 model nằm DƯỚI nó trong danh sách đã xếp theo sức mạnh.
     * Tuyệt đối không dùng model mạnh hơn model ưu tiên.
     */
    fun buildModelChain(
        sortedModels: List<String>,
        preferredModel: String,
        autoFallback: Boolean
    ): List<String> {
        val cleanPreferred = normalizeModelName(preferredModel).ifBlank { DEFAULT_PREFERRED_MODEL }
        if (!autoFallback) {
            return listOf(cleanPreferred)
        }
        val fullSorted = sortModelsByStrength(
            if (sortedModels.contains(cleanPreferred)) sortedModels else (listOf(cleanPreferred) + sortedModels)
        )
        val startIdx = fullSorted.indexOf(cleanPreferred)
        if (startIdx < 0) return listOf(cleanPreferred)
        return fullSorted.drop(startIdx).take(6)
    }
}
