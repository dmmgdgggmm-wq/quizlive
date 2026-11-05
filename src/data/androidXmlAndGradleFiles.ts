export interface AndroidSourceFile {
  path: string;
  category: 'gradle' | 'manifest' | 'xml' | 'kotlin';
  language: 'kotlin' | 'xml' | 'gradle' | 'properties' | 'proguard';
  description: string;
  content: string;
}

export const ANDROID_XML_AND_GRADLE_FILES: AndroidSourceFile[] = [
  {
    path: 'settings.gradle.kts',
    category: 'gradle',
    language: 'gradle',
    description: 'Cấu hình kho lưu trữ plugin và module :app của dự án QuizSnap Overlay',
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "QuizSnapOverlay"
include(":app")
`,
  },
  {
    path: 'build.gradle.kts',
    category: 'gradle',
    language: 'gradle',
    description: 'Top-level Gradle build file khai báo Android Application và Kotlin Android plugin',
    content: `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
`,
  },
  {
    path: 'gradle.properties',
    category: 'gradle',
    language: 'properties',
    description: 'Cấu hình JVM arguments, AndroidX và non-transitive R class',
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,
  },
  {
    path: 'app/build.gradle.kts',
    category: 'gradle',
    language: 'gradle',
    description: 'Cấu hình module :app (minSdk 26, targetSdk 34, compileSdk 34, ViewBinding, Retrofit, DataStore, Security Crypto)',
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.quizoverlay"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.quizoverlay"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Coroutines & Lifecycle
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")

    // DataStore Preferences & EncryptedSharedPreferences
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Retrofit + OkHttp + Gson
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.11.0")
}
`,
  },
  {
    path: 'app/proguard-rules.pro',
    category: 'gradle',
    language: 'proguard',
    description: 'Quy tắc ProGuard giữ nguyên các lớp DTO cho Gson và Retrofit',
    content: `-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class com.example.quizoverlay.network.** { *; }
-keep class com.example.quizoverlay.model.** { *; }
`,
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    category: 'manifest',
    language: 'xml',
    description: 'Khai báo quyền hệ thống, MainActivity (singleTop, adjustResize) và FloatingService (mediaProjection, allowBackup=false)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.QuizSnapOverlay"
        tools:targetApi="34">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".service.FloatingService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaProjection" />
    </application>

</manifest>
`,
  },
  {
    path: 'app/src/main/res/xml/backup_rules.xml',
    category: 'xml',
    language: 'xml',
    description: 'Loại trừ hoàn toàn file lưu trữ khóa API khỏi sao lưu tự động',
    content: `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="sharedpref" path="quiz_secure_api_keys_prefs.xml" />
    <exclude domain="SharedPreferences" path="." />
</full-backup-content>
`,
  },
  {
    path: 'app/src/main/res/xml/data_extraction_rules.xml',
    category: 'xml',
    language: 'xml',
    description: 'Quy tắc chặn sao lưu đám mây và truyền thiết bị đối với EncryptedSharedPreferences (Android 12+)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="quiz_secure_api_keys_prefs.xml" />
        <exclude domain="file" path="datastore/" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="quiz_secure_api_keys_prefs.xml" />
    </device-transfer>
</data-extraction-rules>
`,
  },
  {
    path: 'app/src/main/res/values/colors.xml',
    category: 'xml',
    language: 'xml',
    description: 'Bảng màu chuẩn của QuizSnap Overlay (#0F172A, #1E293B, #F8FAFC, #10B981, #34D399, #334155, #022C22)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="bg_screen">#0F172A</color>
    <color name="bg_card">#1E293B</color>
    <color name="bg_active_row">#2610B981</color>
    <color name="text_primary">#F8FAFC</color>
    <color name="text_secondary">#CBD5E1</color>
    <color name="text_muted">#94A3B8</color>
    <color name="accent_primary">#10B981</color>
    <color name="accent_bright">#34D399</color>
    <color name="btn_secondary">#334155</color>
    <color name="text_on_accent">#022C22</color>
    <color name="badge_fallback_yellow">#FACC15</color>
    <color name="danger_rose">#FB7185</color>
    <color name="overlay_box_bg">#D9000000</color>
    <color name="overlay_box_stroke">#6694A3B8</color>
</resources>
`,
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    category: 'xml',
    language: 'xml',
    description: 'Chuỗi văn bản tiếng Việt hiển thị trên ứng dụng',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">QuizSnap Overlay</string>
    <string name="header_title">QuizSnap Overlay — Cài Đặt</string>
    <string name="header_subtitle">Biểu tượng nổi chụp màn hình, gửi nguyên ảnh cho Gemini API đọc bài tập</string>
</resources>
`,
  },
  {
    path: 'app/src/main/res/values/themes.xml',
    category: 'xml',
    language: 'xml',
    description: 'Theme MaterialComponents.DayNight.NoActionBar tối đồng bộ thanh trạng thái #0F172A',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.QuizSnapOverlay" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="colorPrimary">@color/accent_primary</item>
        <item name="colorPrimaryVariant">@color/accent_bright</item>
        <item name="colorOnPrimary">@color/text_on_accent</item>
        <item name="colorSecondary">@color/accent_bright</item>
        <item name="android:statusBarColor">@color/bg_screen</item>
        <item name="android:navigationBarColor">@color/bg_screen</item>
        <item name="android:windowBackground">@color/bg_screen</item>
    </style>
</resources>
`,
  },
  {
    path: 'app/src/main/res/drawable/bg_card_dark.xml',
    category: 'xml',
    language: 'xml',
    description: 'Nền bo góc #1E293B cho các thẻ cài đặt',
    content: `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/bg_card" />
    <corners android:radius="14dp" />
    <stroke
        android:width="1dp"
        android:color="#3394A3B8" />
</shape>
`,
  },
  {
    path: 'app/src/main/res/drawable/bg_card_active_route.xml',
    category: 'xml',
    language: 'xml',
    description: 'Nền thẻ ĐANG DÙNG nổi bật với viền xanh #10B981',
    content: `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/bg_card" />
    <corners android:radius="14dp" />
    <stroke
        android:width="1.5dp"
        android:color="@color/accent_primary" />
</shape>
`,
  },
  {
    path: 'app/src/main/res/drawable/bg_answer_overlay.xml',
    category: 'xml',
    language: 'xml',
    description: 'Khung nền trong suốt 100%, bo góc 6dp, viền mảnh 1dp #6694A3B8 (sẽ ẩn viền về 0dp khi bật tùy chọn ẩn khung)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
    <corners android:radius="6dp" />
    <stroke
        android:width="1dp"
        android:color="#6694A3B8" />
</shape>
`,
  },
  {
    path: 'app/src/main/res/drawable/ic_notification_scan.xml',
    category: 'xml',
    language: 'xml',
    description: 'Vector icon cho Foreground Service Notification',
    content: `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#10B981"
        android:pathData="M12,4A8,8 0 1,0 20,12A8,8 0 0,0 12,4M12,18A6,6 0 1,1 18,12A6,6 0 0,1 12,18M12,9A3,3 0 1,0 15,12A3,3 0 0,0 12,9Z" />
</vector>
`,
  },
  {
    path: 'app/src/main/res/layout/overlay_floating_icon.xml',
    category: 'xml',
    language: 'xml',
    description: 'Layout biểu tượng nổi: vùng chạm trong suốt tối thiểu 48dp chứa chấm tròn cấu hình kích thước (mm) và alpha riêng biệt',
    content: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/floatingTouchRoot"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:minWidth="48dp"
    android:minHeight="48dp"
    android:background="@android:color/transparent"
    android:clickable="true"
    android:focusable="false">

    <View
        android:id="@+id/floatingDotView"
        android:layout_width="19dp"
        android:layout_height="19dp"
        android:layout_gravity="center" />

</FrameLayout>
`,
  },
  {
    path: 'app/src/main/res/layout/overlay_answer_box.xml',
    category: 'xml',
    language: 'xml',
    description: 'Layout khung đáp án siêu nhỏ (mặc định 48x32dp, tối thiểu 24x24dp): nền trong suốt 100%, không có dấu chấm góc, viền mảnh 1dp #6694A3B8 (ẩn sạch khi bật tùy chọn ẩn viền)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/answerBoxRoot"
    android:layout_width="48dp"
    android:layout_height="32dp"
    android:minWidth="24dp"
    android:minHeight="24dp"
    android:background="@drawable/bg_answer_overlay">

    <ScrollView
        android:id="@+id/answerScrollView"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@android:color/transparent"
        android:fillViewport="true"
        android:scrollbars="none">

        <TextView
            android:id="@+id/tvAnswerContent"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:background="@android:color/transparent"
            android:gravity="center"
            android:includeFontPadding="false"
            android:shadowColor="#D9000000"
            android:shadowDx="0"
            android:shadowDy="1.5"
            android:shadowRadius="8"
            android:textColor="#FFFFFF"
            android:textSize="16sp"
            android:textStyle="bold"
            android:text="" />
    </ScrollView>

    <!-- Không hiển thị dấu chấm màu xanh (dùng màu trong suốt, vẫn hỗ trợ chạm kéo thay đổi cỡ) -->
    <View
        android:id="@+id/resizeHandle"
        android:layout_width="14dp"
        android:layout_height="14dp"
        android:layout_gravity="bottom|end"
        android:layout_marginEnd="2dp"
        android:layout_marginBottom="2dp"
        android:background="@android:color/transparent" />

</FrameLayout>
`,
  },
  {
    path: 'app/src/main/res/layout/activity_main.xml',
    category: 'xml',
    language: 'xml',
    description: 'Giao diện màn hình cài đặt chính (ScrollView tối #0F172A, Thẻ ĐANG DÙNG, và 4 thẻ cài đặt chuẩn ViewBinding)',
    content: `<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/rootScrollView"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/bg_screen"
    android:fillViewport="true">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:padding="16dp">

        <!-- Tiêu đề & Phụ đề -->
        <TextView
            android:id="@+id/tvTitle"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="QuizSnap Overlay — Cài Đặt"
            android:textColor="@color/text_primary"
            android:textSize="22sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/tvSubtitle"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:text="Biểu tượng nổi chụp màn hình, gửi nguyên ảnh cho Gemini API đọc bài tập"
            android:textColor="@color/text_secondary"
            android:textSize="13sp" />

        <!-- Phía trên cùng: Nút lớn Bật/Tắt + Nút Đặt lại mặc định -->
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnToggleService"
            android:layout_width="match_parent"
            android:layout_height="54dp"
            android:layout_marginTop="16dp"
            android:backgroundTint="@color/accent_primary"
            android:text="Bật biểu tượng nổi"
            android:textAllCaps="false"
            android:textColor="@color/text_on_accent"
            android:textSize="16sp"
            android:textStyle="bold"
            app:cornerRadius="12dp" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnResetDefault"
            android:layout_width="match_parent"
            android:layout_height="46dp"
            android:layout_marginTop="8dp"
            android:backgroundTint="@color/btn_secondary"
            android:text="Đặt lại mặc định"
            android:textAllCaps="false"
            android:textColor="@color/text_primary"
            android:textSize="12sp"
            app:cornerRadius="10dp" />

        <!-- THẺ ĐANG DÙNG (ActiveRouteState realtime) -->
        <LinearLayout
            android:id="@+id/cardActiveRoute"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="14dp"
            android:background="@drawable/bg_card_active_route"
            android:clickable="true"
            android:focusable="true"
            android:orientation="vertical"
            android:padding="14dp">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    android:id="@+id/tvActiveRouteHeadline"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Sẽ dùng: gemini-3.8-flash · API 1/1"
                    android:textColor="@color/accent_bright"
                    android:textSize="15sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/tvKeyTail4"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="6dp"
                    android:text="(key ...????)"
                    android:textColor="@color/text_muted"
                    android:textSize="12sp" />

                <TextView
                    android:id="@+id/tvFallbackBadge"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="8dp"
                    android:background="#33FACC15"
                    android:paddingHorizontal="6dp"
                    android:paddingVertical="2dp"
                    android:text="DỰ PHÒNG"
                    android:textColor="@color/badge_fallback_yellow"
                    android:textSize="11sp"
                    android:textStyle="bold"
                    android:visibility="gone" />
            </LinearLayout>

            <TextView
                android:id="@+id/tvFallbackReasonLine"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:text="Ưu tiên: gemini-3.8-flash (hết quota trên mọi API)"
                android:textColor="@color/badge_fallback_yellow"
                android:textSize="12sp"
                android:visibility="gone" />

            <TextView
                android:id="@+id/tvLastScanLine"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:text="Chưa quét lần nào"
                android:textColor="@color/text_secondary"
                android:textSize="12sp" />

            <LinearLayout
                android:id="@+id/layoutApiStatusList"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="vertical" />
        </LinearLayout>

        <!-- THẺ 1: Quyền Hệ Thống (Overlay & Quay Màn Hình) -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:background="@drawable/bg_card_dark"
            android:orientation="vertical"
            android:padding="16dp">

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="1. Quyền Hệ Thống (Overlay &amp; Quay Màn Hình)"
                android:textColor="@color/text_primary"
                android:textSize="16sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/tvOverlayPermissionStatus"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:text="Quyền hiển thị trên ứng dụng khác (Overlay): CHƯA CẤP"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:text="• Bước 1: Bấm 'Cấp quyền Overlay' và bật cho phép vẽ đè.\n• Bước 2: Nhập Gemini API Key ở mục 2 bên dưới.\n• Bước 3: Bấm 'Bật biểu tượng nổi' và chấp nhận quyền Quay màn hình 1 lần duy nhất."
                android:textColor="@color/text_muted"
                android:textSize="12sp" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnGrantOverlayPermission"
                android:layout_width="match_parent"
                android:layout_height="46dp"
                android:layout_marginTop="10dp"
                android:backgroundTint="@color/btn_secondary"
                android:text="Cấp quyền hiển thị trên ứng dụng khác (Overlay)"
                android:textAllCaps="false"
                android:textColor="@color/text_primary"
                android:textSize="13sp"
                app:cornerRadius="10dp" />
        </LinearLayout>

        <!-- THẺ 2: Gemini API, Chọn Model & Prompt Tùy Chỉnh -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:background="@drawable/bg_card_dark"
            android:orientation="vertical"
            android:padding="16dp">

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="2. Gemini API, Chọn Model &amp; Prompt Tùy Chỉnh"
                android:textColor="@color/text_primary"
                android:textSize="16sp"
                android:textStyle="bold" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:gravity="top"
                android:orientation="horizontal">

                <EditText
                    android:id="@+id/etApiKeys"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:background="#0F172A"
                    android:gravity="top|start"
                    android:hint="Mỗi dòng một Gemini API key (tối đa 5)"
                    android:inputType="textMultiLine|textPassword"
                    android:maxLines="5"
                    android:minLines="3"
                    android:padding="12dp"
                    android:textColor="@color/text_primary"
                    android:textColorHint="@color/text_muted"
                    android:textSize="13sp" />

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnToggleShowKeys"
                    android:layout_width="wrap_content"
                    android:layout_height="44dp"
                    android:layout_marginStart="8dp"
                    android:backgroundTint="@color/btn_secondary"
                    android:text="Hiện Key"
                    android:textAllCaps="false"
                    android:textColor="@color/text_primary"
                    android:textSize="12sp"
                    app:cornerRadius="8dp" />
            </LinearLayout>

            <TextView
                android:id="@+id/tvCreateKeyLink"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:text="Tạo key tại aistudio.google.com/apikey"
                android:textColor="@color/accent_bright"
                android:textSize="12sp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:text="API 1 hết quota → sang API 2, 3...; hết mọi API → xuống model yếu hơn"
                android:textColor="@color/text_muted"
                android:textSize="12sp" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="horizontal"
                android:weightSum="2">

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnSaveAndProbeModels"
                    android:layout_width="0dp"
                    android:layout_height="46dp"
                    android:layout_marginEnd="6dp"
                    android:layout_weight="1"
                    android:backgroundTint="@color/accent_primary"
                    android:text="Lưu Key &amp; Dò Model"
                    android:textAllCaps="false"
                    android:textColor="@color/text_on_accent"
                    android:textSize="13sp"
                    android:textStyle="bold"
                    app:cornerRadius="10dp" />

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnRefreshModels"
                    android:layout_width="0dp"
                    android:layout_height="46dp"
                    android:layout_marginStart="6dp"
                    android:layout_weight="1"
                    android:backgroundTint="@color/btn_secondary"
                    android:text="Làm mới DS Model"
                    android:textAllCaps="false"
                    android:textColor="@color/text_primary"
                    android:textSize="13sp"
                    app:cornerRadius="10dp" />
            </LinearLayout>

            <TextView
                android:id="@+id/tvModelProbeStatus"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:text="Trạng thái: Đang dùng danh sách model mặc định (8 model)"
                android:textColor="@color/accent_bright"
                android:textSize="13sp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:text="Model ưu tiên (tự xuống model yếu hơn khi hết quota)"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <Spinner
                android:id="@+id/spinnerPreferredModel"
                android:layout_width="match_parent"
                android:layout_height="46dp"
                android:layout_marginTop="6dp"
                android:background="#0F172A"
                android:paddingHorizontal="10dp" />

            <androidx.appcompat.widget.SwitchCompat
                android:id="@+id/switchAutoFallbackModel"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:checked="true"
                android:text="Tự chuyển xuống model yếu hơn khi hết quota"
                android:textColor="@color/text_primary"
                android:textSize="13sp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:text="Mức suy luận (thinkingConfig)"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <Spinner
                android:id="@+id/spinnerThinkingLevel"
                android:layout_width="match_parent"
                android:layout_height="46dp"
                android:layout_marginTop="6dp"
                android:background="#0F172A"
                android:paddingHorizontal="10dp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:text="Prompt tùy chỉnh cho phần trả lời"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <EditText
                android:id="@+id/etCustomPrompt"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:background="#0F172A"
                android:gravity="top|start"
                android:hint="Nhập prompt yêu cầu cách AI trả lời (ví dụ: Giải câu hỏi trong ảnh và chỉ ghi đáp án ngắn gọn...)"
                android:inputType="textMultiLine"
                android:minLines="2"
                android:padding="12dp"
                android:textColor="@color/text_primary"
                android:textColorHint="@color/text_muted"
                android:textSize="13sp" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:orientation="horizontal"
                android:weightSum="2">

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnTestReadImage"
                    android:layout_width="0dp"
                    android:layout_height="46dp"
                    android:layout_marginEnd="6dp"
                    android:layout_weight="1"
                    android:backgroundTint="@color/btn_secondary"
                    android:text="Thử đọc ảnh (test model)"
                    android:textAllCaps="false"
                    android:textColor="@color/text_primary"
                    android:textSize="12sp"
                    app:cornerRadius="10dp" />

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnPingConnection"
                    android:layout_width="0dp"
                    android:layout_height="46dp"
                    android:layout_marginStart="6dp"
                    android:layout_weight="1"
                    android:backgroundTint="@color/btn_secondary"
                    android:text="Kiểm tra kết nối (Ping - 0 Quota)"
                    android:textAllCaps="false"
                    android:textColor="@color/text_primary"
                    android:textSize="12sp"
                    app:cornerRadius="10dp" />
            </LinearLayout>

            <TextView
                android:id="@+id/tvDiagnosticResult"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:textColor="@color/text_secondary"
                android:textSize="12sp"
                android:visibility="gone" />
        </LinearLayout>

        <!-- THẺ 3: Biểu Tượng Nổi (Cập Nhật Realtime) -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:background="@drawable/bg_card_dark"
            android:orientation="vertical"
            android:padding="16dp">

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="3. Biểu Tượng Nổi (Cập Nhật Realtime)"
                android:textColor="@color/text_primary"
                android:textSize="16sp"
                android:textStyle="bold" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="horizontal">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Đường kính (2mm – 15mm)"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <TextView
                    android:id="@+id/tvIconDiameterValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="3.0 mm (~19 dp)"
                    android:textColor="@color/accent_bright"
                    android:textSize="13sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <SeekBar
                android:id="@+id/seekBarIconDiameter"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:max="130"
                android:progress="10" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="horizontal">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Độ hiển thị / Trong suốt (0% – 100%)"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <TextView
                    android:id="@+id/tvIconAlphaValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="85%"
                    android:textColor="@color/accent_bright"
                    android:textSize="13sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <SeekBar
                android:id="@+id/seekBarIconAlpha"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:max="100"
                android:progress="85" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:text="Lưu ý: Ở 0% biểu tượng hoàn toàn vô hình nhưng vẫn bấm được ở vị trí cũ (vùng chạm tối thiểu 40dp). Biểu tượng tự hiện 100% trong 2 giây khi mới bật hoặc vừa kéo xong."
                android:textColor="@color/text_muted"
                android:textSize="12sp" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:text="Màu chấm tròn (HEX)"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <EditText
                android:id="@+id/etIconColorHex"
                android:layout_width="match_parent"
                android:layout_height="44dp"
                android:layout_marginTop="6dp"
                android:background="#0F172A"
                android:hint="#10B981"
                android:inputType="textCapCharacters"
                android:paddingHorizontal="12dp"
                android:text="#10B981"
                android:textColor="@color/text_primary"
                android:textColorHint="@color/text_muted"
                android:textSize="13sp" />

            <LinearLayout
                android:id="@+id/layoutIconQuickColors"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:orientation="horizontal" />
        </LinearLayout>

        <!-- THẺ 4: Khung Trả Lời Siêu Nhỏ (Mặc Định 48x32dp) -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:layout_marginBottom="28dp"
            android:background="@drawable/bg_card_dark"
            android:orientation="vertical"
            android:padding="16dp">

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="4. Khung Trả Lời Siêu Nhỏ (Mặc Định 48x32dp)"
                android:textColor="@color/text_primary"
                android:textSize="16sp"
                android:textStyle="bold" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="horizontal">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Kích thước chữ đáp án:"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <TextView
                    android:id="@+id/tvAnswerTextSizeValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="16 sp"
                    android:textColor="@color/accent_bright"
                    android:textSize="13sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <SeekBar
                android:id="@+id/seekBarAnswerTextSize"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:max="22"
                android:progress="6" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:orientation="horizontal">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Thời gian tự ẩn khung đáp án:"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <TextView
                    android:id="@+id/tvAnswerAutoHideValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="5 giây"
                    android:textColor="@color/accent_bright"
                    android:textSize="13sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <SeekBar
                android:id="@+id/seekBarAnswerAutoHide"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:max="30"
                android:progress="5" />

            <androidx.appcompat.widget.SwitchCompat
                android:id="@+id/switchAnswerHideBorder"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:checked="false"
                android:text="Ẩn viền khung đáp án (chỉ hiện chữ trên nền trong suốt):"
                android:textColor="@color/text_secondary"
                android:textSize="13sp" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="Màu chữ hiển thị đáp án (Mã HEX):"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <EditText
                    android:id="@+id/etAnswerTextColorHex"
                    android:layout_width="104dp"
                    android:layout_height="38dp"
                    android:background="#0F172A"
                    android:gravity="center"
                    android:hint="#FFFFFF"
                    android:inputType="textCapCharacters"
                    android:paddingHorizontal="8dp"
                    android:text="#FFFFFF"
                    android:textColor="@color/text_primary"
                    android:textColorHint="@color/text_muted"
                    android:textSize="13sp" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/layoutAnswerQuickColors"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:orientation="horizontal" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:text="Mẹo: Khung nền hoàn toàn trong suốt, không có dấu chấm màu xanh. Kéo góc dưới-phải để thu phóng (tối thiểu 24x24dp). Chạm 1 lần vào khung để ẩn ngay."
                android:textColor="@color/text_muted"
                android:textSize="12sp" />

            <androidx.appcompat.widget.SwitchCompat
                android:id="@+id/switchBatchMode"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:checked="true"
                android:text="Chế độ gửi hàng loạt (Chạm 1 lần = chụp +1, Ấn đè 0.5s = gửi cả loạt):"
                android:textColor="@color/text_primary"
                android:textSize="13sp"
                android:textStyle="bold" />
        </LinearLayout>

    </LinearLayout>
</ScrollView>
`,
  },
];
