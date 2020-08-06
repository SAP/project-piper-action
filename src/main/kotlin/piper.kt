import kotlin.js.Promise

@JsModule("@actions/core")
@JsNonModule
external object Core {
    fun getInput(name: String, options: String?): String
}

@JsModule("@actions/tool-cache")
@JsNonModule
external object ToolCache {
    fun downloadTool(url: String): Promise<String>
}

@JsModule("@actions/exec")
@JsNonModule
external object Exec {
    fun exec(path: String)
}

@JsModule("fs")
@JsNonModule
external object FileSystem {
    fun chmodSync(path: String, mode: Int)
}


fun main() {
    val command = Core.getInput("command", null)
    val flags = Core.getInput("flags", null)

    println("command $command")
    println("flags $flags")

    val path = ToolCache.downloadTool("https://github.com/SAP/jenkins-library/releases/latest/download/piper")
    path.then {

        FileSystem.chmodSync(it, 509)
        Exec.exec("$it version")
        Exec.exec("$it $command $flags")
    }

}