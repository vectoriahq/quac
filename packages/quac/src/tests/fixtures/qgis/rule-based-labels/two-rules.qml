<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.44.0" styleCategories="Symbology|Labeling" labelsEnabled="1">
  <renderer-v2 referencescale="-1" type="categorizedSymbol" forceraster="0" symbollevels="0" enableorderby="0" attr="species">
    <categories>
      <category value="Gum" type="string" symbol="0" label="Gum" render="true" uuid="{cat-0}"/>
      <category value="Wattle" type="string" symbol="1" label="Wattle" render="true" uuid="{cat-1}"/>
      <category value="NULL" type="NULL" symbol="2" label="" render="true" uuid="{cat-2}"/>
    </categories>
    <symbols>
    <symbol type="marker" is_animated="0" name="0" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10">
      <layer locked="0" pass="0" enabled="1" id="{marker-0}" class="SimpleMarker">
        <Option type="Map">
          <Option value="27,158,119,255" type="QString" name="color"/>
          <Option value="circle" type="QString" name="name"/>
          <Option value="3" type="QString" name="size"/>
          <Option value="MM" type="QString" name="size_unit"/>
        </Option>
      </layer>
    </symbol>
    <symbol type="marker" is_animated="0" name="1" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10">
      <layer locked="0" pass="0" enabled="1" id="{marker-1}" class="SimpleMarker">
        <Option type="Map">
          <Option value="217,95,2,255" type="QString" name="color"/>
          <Option value="circle" type="QString" name="name"/>
          <Option value="3" type="QString" name="size"/>
          <Option value="MM" type="QString" name="size_unit"/>
        </Option>
      </layer>
    </symbol>
    <symbol type="marker" is_animated="0" name="2" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10">
      <layer locked="0" pass="0" enabled="1" id="{marker-2}" class="SimpleMarker">
        <Option type="Map">
          <Option value="117,112,179,255" type="QString" name="color"/>
          <Option value="circle" type="QString" name="name"/>
          <Option value="3" type="QString" name="size"/>
          <Option value="MM" type="QString" name="size_unit"/>
        </Option>
      </layer>
    </symbol>
    </symbols>
  </renderer-v2>
  <labeling type="rule-based">
    <rules key="{root}">
      <rule key="{tall}" description="Tall trees" filter="&quot;height&quot; &gt; 20">
        <settings calloutType="simple">
          <text-style fieldName="name" isExpression="0" fontFamily="Open Sans" fontSize="12" fontSizeUnit="Point" fontWeight="75" fontItalic="0" textColor="50,50,50,255" textOpacity="1">
            <text-buffer bufferDraw="1" bufferSize="1" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="1"/>
          </text-style>
          <placement placement="0" xOffset="0" yOffset="0" offsetUnits="MM"/>
          <rendering drawLabels="1"/>
        </settings>
      </rule>
      <rule key="{gum}" description="Gums" filter="&quot;species&quot; = 'Gum'">
        <settings calloutType="simple">
          <text-style fieldName="height" isExpression="0" fontFamily="Open Sans" fontSize="8" fontSizeUnit="Point" fontWeight="50" fontItalic="1" textColor="50,50,50,255" textOpacity="1">
            <text-buffer bufferDraw="0"/>
          </text-style>
          <placement placement="0" xOffset="0" yOffset="0" offsetUnits="MM"/>
          <rendering drawLabels="1"/>
        </settings>
      </rule>
    </rules>
  </labeling>
</qgis>
