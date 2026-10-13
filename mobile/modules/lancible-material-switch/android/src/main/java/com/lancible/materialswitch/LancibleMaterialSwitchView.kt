package com.lancible.materialswitch

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.ContextThemeWrapper
import android.view.View
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.types.ColorCompat
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Нативный переключатель Material 3 (MaterialSwitch) внутри вида Expo. Что
// он получает из JS и зачем — в components/Switch.js; здесь то, чего из JS не
// видно.
class LancibleMaterialSwitchView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onValueChange by EventDispatcher()

  // Тема приложения — AppCompat, а стиль MaterialSwitch ссылается на атрибуты
  // Material 3 (minTouchTargetSize, цвета m3_comp_switch_*): без темы M3 вид
  // падает ещё при создании. До экрана палитра темы не доходит — все четыре
  // цвета задаются в applyColors, поэтому и цвета обоев (Material You) наш
  // зелёный не перекрашивают.
  private val switch = ControlledSwitch(
    ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
  ).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    // Для TalkBack переключатель — обёртка: роль, подпись и состояние ей
    // ставит JS, а двойное касание по ней переключает (см. init).
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    thumbIconDrawable = ContextCompat.getDrawable(context, R.drawable.lancible_switch_check)
    onUserChange = { onValueChange(mapOf("value" to it)) }
  }

  // RN не меряет детей нативного вида: без этого переключатель, попросивший
  // новую раскладку, остался бы в старой.
  override val shouldUseAndroidLayout = true

  private val colors = mutableMapOf<String, Int>()
  private var colorsChanged = false

  init {
    // Ореол нажатия у M3 шире кружка — не резать его по краю вида.
    clipChildren = false
    clipToPadding = false
    setOnClickListener { if (switch.isEnabled) switch.toggle() }
    addView(switch)
  }

  fun setValue(value: Boolean) = switch.setValue(value)

  fun setDisabled(disabled: Boolean) {
    switch.isEnabled = !disabled
  }

  fun setColor(name: String, color: Color?) {
    val argb = color?.let { ColorCompat.toArgb(it) } ?: Color.TRANSPARENT
    if (colors.put(name, argb) != argb) colorsChanged = true
  }

  // Перекраска пересобирает рисунки переключателя, поэтому она идёт раз за
  // обновление пропов и только если цвет и правда сменился: иначе каждое
  // переключение (новый value) сбрасывало бы системную анимацию кружка.
  fun applyColors() {
    if (!colorsChanged) return
    colorsChanged = false
    val c = { name: String -> colors[name] ?: Color.TRANSPARENT }
    switch.trackTintList = checkedOr(c("trackOnColor"), c("trackOffColor"))
    // Контур дорожки виден только у выкл. Во вкл он цвета дорожки, а не
    // прозрачный, как у M3 по умолчанию: тон между положениями смешивается по
    // ходу кружка, и прозрачный конец дал бы посередине тёмную кайму.
    switch.trackDecorationTintList = checkedOr(c("trackOnColor"), c("outlineOffColor"))
    switch.thumbTintList = checkedOr(c("thumbOnColor"), c("thumbOffColor"))
    // Галочка проявляется вместе с ходом кружка: у выкл тот же цвет, но
    // прозрачный.
    val icon = c("iconColor")
    switch.thumbIconTintList = checkedOr(icon, icon and 0x00FFFFFF)
  }

  private fun checkedOr(on: Int, off: Int) = ColorStateList(
    arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
    intArrayOf(on, off),
  )
}

// MaterialSwitch, которым управляет JS. Касание и перетаскивание значение не
// меняют — новое уходит наверх (onUserChange), а кружок едет, когда оно
// вернётся пропом value. Экран вправе смену не принять (напоминания без
// разрешения), и переключатель не покажет неправду — как рисованный вариант
// в Switch.js.
private class ControlledSwitch(context: Context) : MaterialSwitch(context) {
  var onUserChange: ((Boolean) -> Unit)? = null
  private var fromProps = false

  fun setValue(value: Boolean) {
    fromProps = true
    isChecked = value
    fromProps = false
  }

  override fun setChecked(checked: Boolean) {
    val report = onUserChange
    if (fromProps || report == null || checked == isChecked) {
      super.setChecked(checked)
      return
    }
    // Кружок возвращается к краю нынешнего значения (после перетаскивания он
    // мог остаться посередине); новое значение решает JS.
    super.setChecked(isChecked)
    report(checked)
  }

  // Стиль M3 растит кружок до 24 и у выкл, если у переключателя вообще есть
  // иконка (состояние state_with_icon). Галочка у нас видна только во вкл,
  // поэтому у выкл это состояние снимается: кружок там 16, как в DESIGN.md.
  override fun onCreateDrawableState(extraSpace: Int): IntArray {
    val state = super.onCreateDrawableState(extraSpace)
    val i = if (isChecked) -1 else state.indexOf(WITH_ICON)
    if (i >= 0) {
      System.arraycopy(state, i + 1, state, i, state.size - i - 1)
      state[state.size - 1] = 0
    }
    return state
  }

  private companion object {
    val WITH_ICON = com.google.android.material.R.attr.state_with_icon
  }
}
