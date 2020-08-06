plugins {
    id("org.jetbrains.kotlin.js") version "1.3.72"
}

group = "org.example"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    implementation(kotlin("stdlib-js"))
    implementation(npm("@actions/core", "^1.2.4"))
    implementation(npm("@actions/exec", "^1.0.4"))
    implementation(npm("@actions/tool-cache", "^1.6.0"))



}

kotlin.target.nodejs { }