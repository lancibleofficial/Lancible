package com.lancible.materialswitch

import android.graphics.Color
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Цвета переключателя — токены темы из components/Switch.js (#rrggbb). Имена
// здесь и в Switch.js сверяет mobile/tests/switch.test.js: Kotlin в jest не
// собирается, и расхождение иначе всплыло бы только в APK.
private val COLOR_PROPS = listOf(
  "trackOnColor", "trackOffColor", "outlineOffColor",
  "thumbOnColor", "thumbOffColor", "iconColor",
)

class LancibleMaterialSwitchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LancibleMaterialSwitch")

    View(LancibleMaterialSwitchView::class) {
      Events("onValueChange")

      Prop("value") { view: LancibleMaterialSwitchView, value: Boolean ->
        view.setValue(value)
      }
      Prop("disabled") { view: LancibleMaterialSwitchView, disabled: Boolean ->
        view.setDisabled(disabled)
      }
      for (name in COLOR_PROPS) {
        Prop(name) { view: LancibleMaterialSwitchView, color: Color? ->
          view.setColor(name, color)
        }
      }

      OnViewDidUpdateProps { view: LancibleMaterialSwitchView ->
        view.applyColors()
      }
    }
  }
}
