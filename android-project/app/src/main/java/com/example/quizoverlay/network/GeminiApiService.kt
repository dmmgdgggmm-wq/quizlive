package com.example.quizoverlay.network

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

interface GeminiApiService {

    @GET("v1beta/models")
    suspend fun listModels(
        @Header("X-Goog-Api-Key") apiKey: String
    ): Response<ModelsListResponseDto>

    @GET("v1beta/models/{model}")
    suspend fun getModelInfo(
        @Path("model", encoded = true) modelName: String,
        @Header("X-Goog-Api-Key") apiKey: String
    ): Response<ModelInfoDto>

    @POST("v1beta/models/{model}:generateContent")
    suspend fun generateContent(
        @Path("model", encoded = true) modelName: String,
        @Header("X-Goog-Api-Key") apiKey: String,
        @Body request: GenerateContentRequestDto
    ): Response<GenerateContentResponseDto>
}

data class ModelsListResponseDto(
    @SerializedName("models") val models: List<ModelInfoDto>?
)

data class ModelInfoDto(
    @SerializedName("name") val name: String?,
    @SerializedName("supportedGenerationMethods") val supportedGenerationMethods: List<String>?
)

data class GenerateContentRequestDto(
    @SerializedName("systemInstruction") val systemInstruction: ContentDto? = null,
    @SerializedName("contents") val contents: List<ContentDto>,
    @SerializedName("generationConfig") val generationConfig: GenerationConfigDto
)

data class ContentDto(
    @SerializedName("role") val role: String? = null,
    @SerializedName("parts") val parts: List<PartDto>
)

data class PartDto(
    @SerializedName("text") val text: String? = null,
    @SerializedName("inlineData") val inlineData: InlineDataDto? = null,
    @SerializedName("thought") val thought: Boolean? = null
)

data class InlineDataDto(
    @SerializedName("mimeType") val mimeType: String = "image/jpeg",
    @SerializedName("data") val data: String
)

data class GenerationConfigDto(
    @SerializedName("temperature") val temperature: Float = 0.2f,
    @SerializedName("maxOutputTokens") val maxOutputTokens: Int = 2048,
    @SerializedName("thinkingConfig") val thinkingConfig: ThinkingConfigDto? = null
)

data class ThinkingConfigDto(
    @SerializedName("thinkingBudget") val thinkingBudget: Int? = null,
    @SerializedName("thinkingLevel") val thinkingLevel: String? = null
)

data class GenerateContentResponseDto(
    @SerializedName("candidates") val candidates: List<CandidateDto>?,
    @SerializedName("promptFeedback") val promptFeedback: PromptFeedbackDto?
)

data class CandidateDto(
    @SerializedName("content") val content: ContentDto?,
    @SerializedName("finishReason") val finishReason: String?
)

data class PromptFeedbackDto(
    @SerializedName("blockReason") val blockReason: String?
)

data class GeminiErrorEnvelopeDto(
    @SerializedName("error") val error: GeminiErrorDetailDto?
)

data class GeminiErrorDetailDto(
    @SerializedName("code") val code: Int?,
    @SerializedName("message") val message: String?,
    @SerializedName("status") val status: String?
)
